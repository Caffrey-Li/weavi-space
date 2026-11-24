import type { SessionUser } from "../auth";
import { onBugStatusChanged } from "../delivery/bug-hook";
import type { ReferenceGuard } from "../open-api/refs";
import { result, conflictResult } from "../requirements/result";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { bugVisible, canSeeBug, canSeeProject, requirementVisible } from "../access";
import { BUG_STATUS_KEYS, isBugReturn, readBugOwners, validateBugOwners, validateBugRefs } from "./write";
import { bugStatusLabel, SEVERITY_OPTIONS } from "../shared/constants";
import { parseDate, readDescription, resolveProductRefs } from "../requirement-write";
import { linkAttachments } from "../shared/attachments";
import { RevisionConflict, baseRevision } from "../shared/optimistic";

export async function GET(session: SessionUser, params: { id: string }) {
  const b = await prisma.bug.findFirst({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      summary: true,
      descriptionHtml: true,
      projectId: true,
      requirementId: true,
      assigneeId: true,
      frontendId: true,
      backendId: true,
      frontend: { select: { name: true } },
      backend: { select: { name: true } },
      severity: true,
      status: true,
      productId: true,
      productNodeId: true,
      environment: true,
      device: true,
      foundVersion: true,
      docUrl: true,
      reopenCount: true,
      revision: true,
      dueAt: true,
      assignee: { select: { name: true } },
      creatorId: true,
    },
  });
  if (!b || !(await canSeeBug(session, b))) return result({ error: "Bug 不存在" }, { status: 404 });
  return result({
    bug: {
      ...b,
      dueAt: b.dueAt ? b.dueAt.toISOString().slice(0, 10) : null,
      assigneeName: b.assignee?.name ?? null,
      // 旧数据只有处理人：当作后端负责人展示
      backendId: b.backendId || (!b.frontendId ? b.assigneeId : null),
      frontendName: b.frontend?.name ?? null,
      backendName: b.backend?.name ?? (!b.frontendId ? b.assignee?.name ?? null : null),
    },
  });
}

export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>, guard?: ReferenceGuard) {
  const existing = await prisma.bug.findFirst({ where: { id: params.id } });
  if (!existing || !(await bugVisible(session, existing.id))) return result({ error: "Bug 不存在" }, { status: 404 });
  if (!(await can(session, "bugs.edit", existing.projectId))) {
    return result({ error: "无权限编辑该 Bug" }, { status: 403 });
  }
  let base: number;
  try {
    base = baseRevision(body, existing.revision);
  } catch (e) {
    if (e instanceof RevisionConflict) return conflictResult(e);
    throw e;
  }
  const next = {
    title: "title" in body ? String(body.title || "").trim().slice(0, 200) : existing.title,
    summary: existing.summary,
    projectId: "projectId" in body ? (body.projectId ? String(body.projectId) : null) : existing.projectId,
    requirementId: "requirementId" in body ? (body.requirementId ? String(body.requirementId) : null) : existing.requirementId,
    ...readBugOwners(body, existing),
    severity: "severity" in body ? String(body.severity) : existing.severity,
    status: "status" in body ? String(body.status) : existing.status,
  };
  if (!next.title) return result({ error: "标题必填" }, { status: 400 });
  if (!BUG_STATUS_KEYS.includes(next.status)) return result({ error: "非法状态" }, { status: 400 });
  if (guard && !(SEVERITY_OPTIONS as readonly string[]).includes(next.severity)) return result({ error: "非法严重级别" }, { status: 400 });
  if (!next.projectId && existing.projectId) return result({ error: "Bug 必须属于某个项目" }, { status: 400 });
  if (guard && !(await guard({ projectId: next.projectId !== existing.projectId ? next.projectId : null, requirementId: next.requirementId !== existing.requirementId ? next.requirementId : null }))) return result({ error: "关联资源不存在" }, { status: 404 });
  // 改到看不到的项目 / 需求按不存在处理（T32）
  if (next.projectId && next.projectId !== existing.projectId && !(await canSeeProject(session, next.projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (next.requirementId && next.requirementId !== existing.requirementId && !(await requirementVisible(session, next.requirementId))) return result({ error: "关联需求不存在" }, { status: 404 });
  const refError =
    (await validateBugRefs({ ...next, assigneeId: null, previousProjectId: existing.projectId })) ||
    (await validateBugOwners(next.projectId, next, { frontendId: existing.frontendId, backendId: existing.backendId ?? existing.assigneeId, projectId: existing.projectId }));
  if (refError) return result({ error: refError }, { status: 400 });
  if (guard && !(await guard({ frontendId: next.frontendId !== existing.frontendId ? next.frontendId : null, backendId: next.backendId !== existing.backendId ? next.backendId : null }))) return result({ error: "负责人不存在" }, { status: 404 });
  if (next.projectId !== existing.projectId && !(await can(session, "bugs.edit", next.projectId))) {
    return result({ error: "无权限把 Bug 移到该项目" }, { status: 403 });
  }
  const description = readDescription(body);
  const extra: Record<string, unknown> = {};
  if (description) {
    extra.summary = description.summary;
    extra.descriptionHtml = description.descriptionHtml;
  }
  if ("productId" in body || "productNodeId" in body) {
    if (guard && !(await guard({ productId: body.productId, productNodeId: body.productNodeId }))) return result({ error: "产品不存在" }, { status: 404 });
    const refs = await resolveProductRefs(
      "productId" in body ? body.productId : existing.productId,
      "productNodeId" in body ? body.productNodeId : null,
    );
    if ("error" in refs) return result({ error: refs.error }, { status: 400 });
    Object.assign(extra, refs);
  }
  for (const [key, max] of [["environment", 20], ["device", 80], ["foundVersion", 40]] as const) {
    if (key in body) extra[key] = body[key] ? String(body[key]).trim().slice(0, max) || null : null;
  }
  if ("dueAt" in body) extra.dueAt = parseDate(body.dueAt);
  if ("docUrl" in body) {
    const url = body.docUrl ? String(body.docUrl).trim().slice(0, 500) : "";
    if (url && !/^https?:\/\//i.test(url)) return result({ error: "链接需以 http(s):// 开头" }, { status: 400 });
    extra.docUrl = url || null;
  }
  const FIELD_LABELS: [string, string][] = [
    ["title", "标题"], ["severity", "严重程度"], ["frontendId", "前端负责人"], ["backendId", "后端负责人"], ["requirementId", "关联需求"], ["projectId", "所属项目"],
    ["productId", "所属产品"], ["productNodeId", "功能模块"], ["environment", "环境"], ["device", "浏览器 / 设备"], ["foundVersion", "发现版本"], ["dueAt", "截止日期"], ["docUrl", "相关链接"],
  ];
  const merged: Record<string, unknown> = { ...next, ...extra };
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);
  const changedFields = FIELD_LABELS.filter(([k]) => k in body && k in merged && norm(merged[k]) !== norm((existing as Record<string, unknown>)[k])).map(([, l]) => l);
  if (description && (description.descriptionHtml ?? "") !== (existing.descriptionHtml ?? "")) changedFields.push("描述");
  const back = isBugReturn(existing.status, next.status);
  if (back) extra.reopenCount = { increment: 1 };
  if (guard && !(await guard({ descriptionHtml: body.descriptionHtml }))) return result({ error: "附件不存在" }, { status: 404 });
  const written = await prisma.bug.updateMany({ where: { id: existing.id, revision: base }, data: { ...next, ...extra } });
  if (written.count === 0) return conflictResult(new RevisionConflict());
  const updated = { reopenCount: existing.reopenCount + (back ? 1 : 0) };
  if (description?.descriptionHtml) await linkAttachments(existing.id, description.descriptionHtml, "bug");
  await prisma.activityLog.create({
    data: {
      entityType: "bug",
      entityId: existing.id,
      action: next.status !== existing.status ? "status_changed" : "updated",
      actorId: session.id,
      fromValue: JSON.stringify({ status: existing.status, assigneeId: existing.assigneeId, frontendId: existing.frontendId, backendId: existing.backendId }),
      toValue: JSON.stringify({ status: next.status, assigneeId: next.assigneeId, frontendId: next.frontendId, backendId: next.backendId }),
      message: back
        ? `退回 ${bugStatusLabel(existing.status)} → ${bugStatusLabel(next.status)}（第 ${updated.reopenCount} 次）`
        : next.status !== existing.status
          ? `状态 ${bugStatusLabel(existing.status)} → ${bugStatusLabel(next.status)}`
          : changedFields.length
            ? `修改 ${changedFields.join("、")}`
            : "编辑 Bug",
    },
  });
  await alignToProjects([existing.projectId, next.projectId]);
  if (next.status !== existing.status) await onBugStatusChanged(existing.id, next.status);
  return result({ ok: true, revision: base + 1 });
}
