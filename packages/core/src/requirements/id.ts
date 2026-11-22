import type { SessionUser } from "../auth";
import { validProposer } from "./flow";
import type { ReferenceGuard } from "../open-api/refs";
import { result, conflictResult } from "./result";
import { LifecycleError, runAction } from "../shared/lifecycle";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, projectWhere, requirementVisible } from "../access";
import { PRIORITY_LABELS } from "../shared/constants";
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
import { linkAttachments } from "../shared/attachments";
import { RevisionConflict, baseRevision } from "../shared/optimistic";

/** 编辑需求：标题、描述、文档、优先级、计划完成、归属项目、按岗位的负责人。状态走 /status。 */

export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>, guard?: ReferenceGuard) {

  const existing = await prisma.requirement.findUnique({
    where: { id: params.id },
    include: { project: { select: { name: true } } },
  });
  if (!existing || !(await requirementVisible(session, existing.id))) return result({ error: "需求不存在" }, { status: 404 });

  if (!(await can(session, "requirements.edit", existing.projectId || undefined))) {
    return result({ error: "无权限编辑该需求" }, { status: 403 });
  }
  // 乐观锁：客户端带了 revision 且已过期时直接拒绝，不做任何写入
  let base: number;
  try {
    base = baseRevision(body, existing.revision);
  } catch (e) {
    if (e instanceof RevisionConflict) return conflictResult(e);
    throw e;
  }

  const data: Record<string, unknown> = {};
  const changes: string[] = [];

  if ("title" in body) {
    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return result({ error: "标题必填" }, { status: 400 });
    if (title !== existing.title) {
      data.title = title;
      changes.push("标题");
    }
  }
  const description = readDescription(body);
  if (description && (description.descriptionHtml !== existing.descriptionHtml || description.summary !== existing.summary)) {
    data.summary = description.summary;
    data.descriptionHtml = description.descriptionHtml;
    changes.push("描述");
  }
  if ("tags" in body) {
    const tags = readTags(body.tags) ?? null;
    if (tags !== existing.tags) {
      data.tags = tags;
      changes.push("标签");
    }
  }
  if ("parentId" in body) {
    const parentId = body.parentId ? String(body.parentId) : null;
    if (parentId !== existing.parentId) {
      if (parentId && guard && !(await guard({ parentId }))) return result({ error: "父需求不存在" }, { status: 404 });
      if (parentId && !(await requirementVisible(session, parentId))) return result({ error: "父需求不存在" }, { status: 404 });
      const err = await validateParent(existing.id, parentId);
      if (err) return result({ error: err }, { status: 400 });
      data.parentId = parentId;
      changes.push(parentId ? "父需求" : "移除父需求");
    }
  }
  // 所属产品用 productRefId（productId 是旧接口的「产品负责人」）
  if ("productRefId" in body || "productNodeId" in body) {
    if (guard && !(await guard({ productRefId: body.productRefId, productNodeId: body.productNodeId }))) return result({ error: "产品不存在" }, { status: 404 });
    const refs = await resolveProductRefs(
      "productRefId" in body ? body.productRefId : existing.productId,
      "productNodeId" in body ? body.productNodeId : null,
    );
    if ("error" in refs) return result({ error: refs.error }, { status: 400 });
    if (refs.productId !== existing.productId || refs.productNodeId !== existing.productNodeId) {
      data.productId = refs.productId;
      data.productNodeId = refs.productNodeId;
      changes.push("产品模块");
    }
  }
  if ("startAt" in body) {
    const d = parseDate(body.startAt);
    if ((d?.getTime() ?? null) !== (existing.startAt?.getTime() ?? null)) {
      data.startAt = d;
      changes.push("开始日期");
    }
  }
  if ("proposerId" in body) {
    const proposerId = body.proposerId ? String(body.proposerId) : null;
    if (proposerId !== existing.proposerId) {
      if (!(await validProposer(session, proposerId))) return result({ error: "提出人不在本企业" }, { status: 400 });
      data.proposerId = proposerId;
      changes.push("提出人");
    }
  }
  if ("docUrl" in body) {
    const docUrl = parseUrl(body.docUrl);
    if (docUrl === "invalid") return result({ error: "文档链接需以 http(s):// 开头" }, { status: 400 });
    if (docUrl !== existing.docUrl) {
      data.docUrl = docUrl;
      changes.push("文档链接");
    }
  }
  if ("priority" in body) {
    const priority = normalizePriority(body.priority as string);
    if (priority !== normalizePriority(existing.priority)) changes.push(`优先级→${PRIORITY_LABELS[priority].label}`);
    data.priority = priority;
  }
  if ("plannedEndAt" in body) {
    const d = parseDate(body.plannedEndAt);
    if ((d?.getTime() ?? null) !== (existing.plannedEndAt?.getTime() ?? null)) {
      data.plannedEndAt = d;
      changes.push("计划完成");
    }
  }

  let targetProjectId = existing.projectId;
  if ("projectId" in body) {
    const next = body.projectId ? String(body.projectId) : null;
    if (next !== existing.projectId) {
      if (next) {
        if (guard && !(await guard({ projectId: next }))) return result({ error: "目标项目不存在" }, { status: 404 });
        // 看不到的目标项目和不存在的同样按 404 处理，再查功能权限
        const p = await prisma.project.findFirst({ where: { id: next, AND: [projectWhere(await getAccess(session))] }, select: { id: true, name: true } });
        if (!p) return result({ error: "目标项目不存在" }, { status: 404 });
        if (!(await can(session, "requirements.create", next))) {
          return result({ error: "无权限把需求放入该项目" }, { status: 403 });
        }
        changes.push(`归属 ${existing.project?.name || "公共池"} → ${p.name}`);
      } else {
        changes.push(`归属 ${existing.project?.name || "公共池"} → 公共池`);
      }
      data.projectId = next;
      targetProjectId = next;
    }
  }

  let assignees = readAssignees(body);
  // 换了项目但没传负责人：已不在新项目里的负责人自动解除，避免挂着非成员
  if (targetProjectId && targetProjectId !== existing.projectId && !assignees) {
    const current = await prisma.requirementAssignee.findMany({ where: { requirementId: existing.id } });
    const members = await prisma.projectMember.findMany({
      where: { projectId: targetProjectId },
      select: { userId: true },
    });
    const ok = new Set(members.map((m) => m.userId));
    assignees = {};
    for (const a of current) if (!ok.has(a.userId)) assignees[a.role] = null;
  }
  const currentAssignees = await prisma.requirementAssignee.findMany({ where: { requirementId: existing.id } });
  const currentMap = new Map(currentAssignees.map((a) => [a.role, a.userId]));
  // 换了项目则全部按新项目校验
  const assigneeError = await validateAssignees(
    targetProjectId,
    assignees,
    targetProjectId === existing.projectId ? currentMap : undefined,
  );
  if (assigneeError) return result({ error: assigneeError }, { status: 400 });
  const changedAssignees = assignees && Object.fromEntries(Object.entries(assignees).filter(([role, id]) => (currentMap.get(role) ?? null) !== (id ?? null)));
  if (guard && !(await guard({ assignees: changedAssignees, descriptionHtml: body.descriptionHtml }))) return result({ error: "关联资源不存在" }, { status: 404 });

  if (assignees) {
    if (Object.entries(assignees).some(([role, uid]) => (currentMap.get(role) ?? null) !== (uid ?? null))) {
      changes.push("负责人");
    }
  }

  let revision = existing.revision;
  if (changes.length || Object.keys(data).length) {
    // 比较版本号后再写；只改了负责人时也刷新 updatedAt（让列表按最近更新排序）并占用一个版本号
    const written = await prisma.requirement.updateMany({
      where: { id: existing.id, revision: base },
      data: Object.keys(data).length ? data : { updatedAt: new Date(), revision: { increment: 1 } },
    });
    if (written.count === 0) return conflictResult(new RevisionConflict());
    revision = base + 1;
    if (data.descriptionHtml) await linkAttachments(existing.id, data.descriptionHtml as string);
  }
  await applyAssignees(existing.id, assignees);

  // T43 计划联动：开始 / 截止改了，没开始的任务一起平移
  let tasksShifted = { count: 0, days: 0 };
  if ("startAt" in data || "plannedEndAt" in data) {
    const { shiftTasks } = await import("./tasks");
    tasksShifted = await shiftTasks(session.id, existing.id, { startAt: existing.startAt, plannedEndAt: existing.plannedEndAt }, { startAt: data.startAt as Date | null | undefined, plannedEndAt: data.plannedEndAt as Date | null | undefined });
  }

  if (changes.length) {
    await prisma.activityLog.create({
      data: {
        entityType: "requirement",
        entityId: existing.id,
        action: "updated",
        actorId: session.id,
        message: `更新了 ${changes.join("、")}`,
      },
    });
  }

  // 级联：归属项目后，所属产品跟随项目的产品
  await alignToProjects([existing.projectId, (data.projectId as string | null | undefined) ?? null]);
  return result({ ok: true, changed: changes, revision, tasksShifted });
}

export async function DELETE(session: SessionUser, params: { id: string }) {
  try {
    await runAction(session, "requirement", params.id, "delete");
    return result({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) return result({ error: e.message }, { status: 400 });
    console.error("[删除需求]", e);
    return result({ error: "删除失败，请稍后重试" }, { status: 500 });
  }
}
