import type { SessionUser } from "../auth";
import { validProposer } from "./flow";
import type { ReferenceGuard } from "../open-api/refs";
import { result } from "./result";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, projectWhere, requirementVisible, requirementWhere } from "../access";
import { linkAttachments } from "../shared/attachments";
import {
  applyAssignees,
  normalizePriority,
  parseDate,
  parseUrl,
  readAssignees,
  readDescription,
  readTags,
  resolveProductRefs,
  validateAssignees,
  validateParent,
} from "../requirement-write";

/** 轻量列表：发版选需求、Bug 关联需求用。?projectId=xxx */

export async function GET(session: SessionUser, requestUrl: string) {
  const url = new URL(requestUrl);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return result({ error: "缺少 projectId" }, { status: 400 });
  // __none__ = 公共池（没有归属项目的需求），新建公共池需求选父需求时用
  const items = await prisma.requirement.findMany({
    where: { projectId: projectId === "__none__" ? null : projectId, archivedAt: null, deletedAt: null, AND: [requirementWhere(await getAccess(session))] },
    select: { id: true, title: true, status: true, priority: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return result({ items });
}

export async function POST(session: SessionUser, body: Record<string, unknown>, guard?: ReferenceGuard) {
  const title = String(body.title || "").trim().slice(0, 200);
  if (!title) return result({ error: "标题必填" }, { status: 400 });
  const projectId = body.projectId ? String(body.projectId) : null;
  if (projectId) {
    if (guard && !(await guard({ projectId }))) return result({ error: "项目不存在" }, { status: 404 });
    // 看不到的项目和不存在的项目同样按 404 处理，再查功能权限，不暴露其他企业的项目 id 是否存在
    const p = await prisma.project.findFirst({ where: { id: projectId, AND: [projectWhere(await getAccess(session))] }, select: { id: true } });
    if (!p) return result({ error: "项目不存在" }, { status: 404 });
  }
  if (!(await can(session, "requirements.create", projectId || undefined))) {
    return result({ error: "无权限新建需求" }, { status: 403 });
  }
  const proposerId = body.proposerId ? String(body.proposerId) : null;
  if (!(await validProposer(session, proposerId))) return result({ error: "提出人不在本企业" }, { status: 400 });
  const docUrl = parseUrl(body.docUrl);
  if (docUrl === "invalid") return result({ error: "文档链接需以 http(s):// 开头" }, { status: 400 });
  // 11-22 需求池只在项目里：新建需求必须选项目
  if (!projectId) return result({ error: "请选择所属项目" }, { status: 400 });

  // 可选：放进本项目「规划中」的版本
  const releaseId = body.releaseId ? String(body.releaseId) : null;
  if (releaseId) {
    if (guard && !(await guard({ releaseId }))) return result({ error: "发版不存在" }, { status: 404 });
    const rel = await prisma.release.findUnique({ where: { id: releaseId }, select: { projectId: true, status: true } });
    if (!rel || rel.projectId !== projectId) return result({ error: "所选版本不属于该项目" }, { status: 400 });
    if (rel.status !== "planning") return result({ error: "所选版本已冻结或已发布，不能再加入需求" }, { status: 400 });
  }
  // 可选：ITR 单号，记在标签里（与 ITR 同步的标签同一处）
  const itrNo = typeof body.itrNo === "string" ? body.itrNo.trim().slice(0, 40) : "";

  const parentId = body.parentId ? String(body.parentId) : null;
  if (parentId && guard && !(await guard({ parentId }))) return result({ error: "父需求不存在" }, { status: 404 });
  // 父需求必须是自己看得到的（别的企业的需求按不存在）
  if (parentId && !(await requirementVisible(session, parentId))) return result({ error: "父需求不存在" }, { status: 404 });
  const parentError = await validateParent(null, parentId);
  if (parentError) return result({ error: parentError }, { status: 400 });
  // 注意：请求体里的 productId 是旧接口的「产品负责人」，所属产品用 productRefId
  if (guard && !(await guard({ productRefId: body.productRefId, productNodeId: body.productNodeId }))) return result({ error: "产品不存在" }, { status: 404 });
  const productRefs = await resolveProductRefs(body.productRefId, body.productNodeId);
  if ("error" in productRefs) return result({ error: productRefs.error }, { status: 400 });
  const description = readDescription(body);
  const extraTags = readTags(body.tags);
  const tagList = [...(extraTags ? (JSON.parse(extraTags) as string[]) : []), ...(itrNo ? [`ITR:${itrNo}`] : [])];

  const assignees = readAssignees(body);
  const assigneeError = await validateAssignees(projectId, assignees);
  if (assigneeError) return result({ error: assigneeError }, { status: 400 });
  if (guard && !(await guard({ assignees, descriptionHtml: body.descriptionHtml }))) return result({ error: "关联资源不存在" }, { status: 404 });

  // 新需求排到「需求中」列最前
  const minOrder = await prisma.requirement.aggregate({
    where: { projectId, status: "req_in_progress" },
    _min: { boardOrder: true },
  });

  const reqRow = await prisma.requirement.create({
    data: {
      title,
      summary: description?.summary ?? null,
      descriptionHtml: description?.descriptionHtml ?? null,
      docUrl,
      projectId,
      parentId,
      proposerId,
      productId: productRefs.productId,
      productNodeId: productRefs.productNodeId,
      priority: normalizePriority(body.priority as string),
      status: "req_in_progress",
      creatorId: session.id,
      boardOrder: (minOrder._min.boardOrder ?? 1) - 1,
      startAt: parseDate(body.startAt),
      plannedEndAt: parseDate(body.plannedEndAt),
      tags: tagList.length ? JSON.stringify(Array.from(new Set(tagList))) : null,
    },
  });
  // 新建前上传的配图归到这条需求
  await linkAttachments(reqRow.id, description?.descriptionHtml);

  await applyAssignees(reqRow.id, assignees);
  if (releaseId) {
    const last = await prisma.releaseRequirement.aggregate({ where: { releaseId }, _max: { sortOrder: true } });
    await prisma.releaseRequirement.create({ data: { releaseId, requirementId: reqRow.id, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  }

  await prisma.activityLog.create({
    data: {
      entityType: "requirement",
      entityId: reqRow.id,
      action: "created",
      actorId: session.id,
      message: "创建需求",
    },
  });
  if (parentId) {
    await prisma.activityLog.create({
      data: { entityType: "requirement", entityId: parentId, action: "child_added", actorId: session.id, message: `添加了子需求「${title}」` },
    });
  }

  // 级联：归属项目后，所属产品跟随项目的产品
  await alignToProjects([projectId]);
  return result({ id: reqRow.id });
}
