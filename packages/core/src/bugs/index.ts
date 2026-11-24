import type { SessionUser } from "../auth";
import type { ReferenceGuard } from "../open-api/refs";
import { SEVERITY_OPTIONS } from "../shared/constants";
import { result } from "../requirements/result";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject, requirementVisible } from "../access";
import { readBugOwners, validateBugOwners, validateBugRefs } from "./write";
import { parseDate, readDescription, resolveProductRefs } from "../requirement-write";
import { linkAttachments } from "../shared/attachments";

export async function POST(session: SessionUser, body: Record<string, unknown>, guard?: ReferenceGuard) {
  const title = String(body.title || "").trim().slice(0, 200);
  if (!title) return result({ error: "标题必填" }, { status: 400 });
  const projectId = body.projectId ? String(body.projectId) : null;
  // 11-22：Bug 必须属于某个项目
  if (!projectId) return result({ error: "请选择所属项目" }, { status: 400 });
  const requirementId = body.requirementId ? String(body.requirementId) : null;
  const owners = readBugOwners(body);
  const assigneeId = owners.assigneeId;
  const severity = String(body.severity || "major");
  if (guard && !(SEVERITY_OPTIONS as readonly string[]).includes(severity)) return result({ error: "非法严重级别" }, { status: 400 });
  if (guard && !(await guard({ projectId, requirementId }))) return result({ error: "关联资源不存在" }, { status: 404 });
  // 看不到的项目 / 需求一律按不存在处理，先于其他校验和功能权限（T32）
  if (projectId && !(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (requirementId && !(await requirementVisible(session, requirementId))) return result({ error: "关联需求不存在" }, { status: 404 });
  const refError = (await validateBugRefs({ projectId, requirementId, assigneeId: null, severity })) || (await validateBugOwners(projectId, owners));
  if (refError) return result({ error: refError }, { status: 400 });
  if (guard && !(await guard(owners))) return result({ error: "负责人不存在" }, { status: 404 });
  if (!(await can(session, "bugs.edit", projectId))) {
    return result({ error: "无权限提交该项目的 Bug" }, { status: 403 });
  }
  let productIdRaw = body.productId;
  let nodeIdRaw = body.productNodeId;
  if (!("productId" in body) && requirementId) {
    const r = await prisma.requirement.findUnique({ where: { id: requirementId }, select: { productId: true, productNodeId: true } });
    productIdRaw = r?.productId;
    nodeIdRaw = r?.productNodeId;
  }
  if (guard && !(await guard({ productId: productIdRaw, productNodeId: nodeIdRaw }))) return result({ error: "产品不存在" }, { status: 404 });
  const productRefs = await resolveProductRefs(productIdRaw, nodeIdRaw);
  if ("error" in productRefs) return result({ error: productRefs.error }, { status: 400 });
  const description = readDescription(body);
  const text = (v: unknown, max: number) => (v ? String(v).trim().slice(0, max) || null : null);
  const docUrl = text(body.docUrl, 500);
  if (docUrl && !/^https?:\/\//i.test(docUrl)) return result({ error: "链接需以 http(s):// 开头" }, { status: 400 });
  if (guard && !(await guard({ descriptionHtml: body.descriptionHtml }))) return result({ error: "附件不存在" }, { status: 404 });
  const min = await prisma.bug.aggregate({ where: { projectId, status: "open" }, _min: { boardOrder: true } });
  const bug = await prisma.bug.create({
    data: {
      title,
      summary: description?.summary ?? null,
      descriptionHtml: description?.descriptionHtml ?? null,
      projectId,
      requirementId,
      productId: productRefs.productId,
      productNodeId: productRefs.productNodeId,
      environment: text(body.environment, 20),
      device: text(body.device, 80),
      foundVersion: text(body.foundVersion, 40),
      docUrl,
      dueAt: parseDate(body.dueAt),
      assigneeId,
      frontendId: owners.frontendId,
      backendId: owners.backendId,
      severity,
      status: "open",
      creatorId: session.id,
      boardOrder: (min._min.boardOrder ?? 1) - 1,
    },
  });
  await prisma.activityLog.create({
    data: { entityType: "bug", entityId: bug.id, action: "created", actorId: session.id, message: "提交 Bug" },
  });
  await linkAttachments(bug.id, description?.descriptionHtml, "bug");
  if (requirementId) {
    await prisma.activityLog.create({
      data: {
        entityType: "requirement",
        entityId: requirementId,
        action: "bug_linked",
        actorId: session.id,
        message: `提交了关联 Bug「${title}」`,
      },
    });
  }
  await alignToProjects([bug.projectId]);
  return result({ id: bug.id });
}
