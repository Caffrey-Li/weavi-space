import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { canSeeProject, getAccess, requirementWhere } from "../access";
import { result } from "./result";
import { reqCodeOf } from "../shared/codes";

/**
 * 迭代（T43，Scrum 模式）：项目里按时间盒规划需求。
 * 看 = 看得到项目；改 = 项目的需求「编辑」权限。同一项目同时只有一个进行中的迭代。
 * 完成迭代时，没上线 / 没取消的需求挪到下一个规划中的迭代（没有就放回待规划）。
 */

const DAY = 86400000;
const DONE = ["online", "cancelled"];

function day(v: unknown): Date | null {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function projectIterations(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return null;
  const its = await prisma.iteration.findMany({ where: { projectId }, orderBy: { startAt: "desc" }, take: 60 });
  const where = { AND: [requirementWhere(await getAccess(session)), { projectId, deletedAt: null, archivedAt: null }] };
  const reqs = await prisma.requirement.findMany({
    where: { ...where, OR: [{ iterationId: { in: its.map((i) => i.id) } }, { iterationId: null, status: { notIn: DONE } }] },
    select: { id: true, number: true, title: true, status: true, priority: true, plannedEndAt: true, iterationId: true, tasks: { where: { status: { not: "cancelled" } }, select: { estimate: true, status: true } } },
    orderBy: [{ boardOrder: "asc" }, { updatedAt: "desc" }],
    take: 1000,
  });
  const row = (r: (typeof reqs)[number], end?: Date) => ({
    id: r.id,
    code: reqCodeOf(r),
    title: r.title,
    status: r.status,
    priority: r.priority,
    plannedEndAt: r.plannedEndAt?.toISOString() ?? null,
    hours: r.tasks.reduce((n, t) => n + (t.estimate || 0), 0),
    risk: !!(end && r.plannedEndAt && r.plannedEndAt.getTime() > end.getTime() + DAY - 1 && !DONE.includes(r.status)),
  });
  const iterations = its.map((it) => {
    const mine = reqs.filter((r) => r.iterationId === it.id);
    const rows = mine.map((r) => row(r, it.endAt));
    return {
      id: it.id,
      name: it.name,
      goal: it.goal,
      status: it.status,
      startAt: it.startAt.toISOString(),
      endAt: it.endAt.toISOString(),
      capacity: it.capacity,
      reqs: rows,
      online: rows.filter((r) => r.status === "online").length,
      hours: rows.reduce((n, r) => n + r.hours, 0),
      risks: rows.filter((r) => r.risk).length,
    };
  });
  const backlog = reqs.filter((r) => !r.iterationId).map((r) => row(r));
  return { iterations, backlog, canEdit: !session.isDemo && (await can(session, "requirements.edit", projectId)) };
}

async function editable(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (session.isDemo || !(await can(session, "requirements.edit", projectId))) return result({ error: "没有规划迭代的权限" }, { status: 403 });
  return null;
}

/** 新建：{ name?, goal?, startAt, endAt, capacity? }；默认名「迭代 N」 */
export async function createIteration(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const denied = await editable(session, projectId);
  if (denied) return denied;
  const start = day(body.startAt), end = day(body.endAt);
  if (!start || !end) return result({ error: "请选择开始和结束日期" }, { status: 400 });
  if (end < start) return result({ error: "结束日期不能早于开始日期" }, { status: 400 });
  if ((end.getTime() - start.getTime()) / DAY > 62) return result({ error: "一个迭代最长两个月" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  const n = await prisma.iteration.count({ where: { projectId } });
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || `迭代 ${n + 1}`;
  const cap = body.capacity === undefined || body.capacity === null || body.capacity === "" ? null : Number(body.capacity);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0 || cap > 100000)) return result({ error: "容量要是 0–100000 小时" }, { status: 400 });
  const it = await prisma.iteration.create({ data: { workspaceId: project?.workspaceId || "ws_default", projectId, name, goal: String(body.goal || "").trim().slice(0, 300) || null, startAt: start, endAt: end, capacity: cap, createdById: session.id } });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "iteration", actorId: session.id, message: `新建${name}` } });
  return result({ id: it.id });
}

/** 改：{ name?, goal?, startAt?, endAt?, capacity?, action?: "start" | "complete", moveTo?: iterationId | null } */
export async function updateIteration(session: SessionUser, projectId: string, iterationId: string, body: Record<string, unknown>) {
  const denied = await editable(session, projectId);
  if (denied) return denied;
  const it = await prisma.iteration.findFirst({ where: { id: iterationId, projectId } });
  if (!it) return result({ error: "迭代不存在" }, { status: 404 });
  if (body.action === "start") {
    if (it.status !== "planning") return result({ error: "只有规划中的迭代可以开始" }, { status: 400 });
    if (await prisma.iteration.findFirst({ where: { projectId, status: "active" }, select: { id: true } })) return result({ error: "已经有进行中的迭代，先完成它" }, { status: 409 });
    await prisma.iteration.update({ where: { id: it.id }, data: { status: "active" } });
    await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "iteration", actorId: session.id, message: `开始${it.name}` } });
    return result({ ok: true });
  }
  if (body.action === "complete") {
    if (it.status !== "active") return result({ error: "只有进行中的迭代可以完成" }, { status: 400 });
    const next = body.moveTo ? await prisma.iteration.findFirst({ where: { id: String(body.moveTo), projectId, status: "planning" }, select: { id: true, name: true } }) : null;
    if (body.moveTo && !next) return result({ error: "要挪去的迭代不存在或不是规划中" }, { status: 404 });
    const moved = await prisma.requirement.updateMany({ where: { iterationId: it.id, status: { notIn: DONE } }, data: { iterationId: next?.id ?? null } });
    await prisma.iteration.update({ where: { id: it.id }, data: { status: "done", closedAt: new Date() } });
    await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "iteration", actorId: session.id, message: `完成${it.name}，${moved.count} 条未完成的需求${next ? `挪到${next.name}` : "放回待规划"}` } });
    return result({ ok: true, moved: moved.count });
  }
  const data: { name?: string; goal?: string | null; startAt?: Date; endAt?: Date; capacity?: number | null } = {};
  if (body.name !== undefined) {
    const n = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!n) return result({ error: "名称不能为空" }, { status: 400 });
    data.name = n;
  }
  if (body.goal !== undefined) data.goal = String(body.goal || "").trim().slice(0, 300) || null;
  if (body.startAt !== undefined) data.startAt = day(body.startAt) ?? it.startAt;
  if (body.endAt !== undefined) data.endAt = day(body.endAt) ?? it.endAt;
  if ((data.endAt ?? it.endAt) < (data.startAt ?? it.startAt)) return result({ error: "结束日期不能早于开始日期" }, { status: 400 });
  if (body.capacity !== undefined) {
    const c = body.capacity === null || body.capacity === "" ? null : Number(body.capacity);
    if (c !== null && (!Number.isFinite(c) || c < 0 || c > 100000)) return result({ error: "容量要是 0–100000 小时" }, { status: 400 });
    data.capacity = c;
  }
  await prisma.iteration.update({ where: { id: it.id }, data });
  return result({ ok: true });
}

/** 规划：{ iterationId | null, requirementIds }；只能动本项目、看得到的需求 */
export async function assignIteration(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const denied = await editable(session, projectId);
  if (denied) return denied;
  const target = body.iterationId ? await prisma.iteration.findFirst({ where: { id: String(body.iterationId), projectId, status: { not: "done" } }, select: { id: true, name: true } }) : null;
  if (body.iterationId && !target) return result({ error: "迭代不存在或已完成" }, { status: 404 });
  const ids = (Array.isArray(body.requirementIds) ? body.requirementIds : []).map(String).slice(0, 200);
  if (!ids.length) return result({ error: "请选择需求" }, { status: 400 });
  const ok = await prisma.requirement.findMany({ where: { id: { in: ids }, projectId, deletedAt: null, AND: [requirementWhere(await getAccess(session))] }, select: { id: true } });
  if (ok.length !== ids.length) return result({ error: "有需求不存在或不在本项目" }, { status: 404 });
  await prisma.requirement.updateMany({ where: { id: { in: ids } }, data: { iterationId: target?.id ?? null } });
  await prisma.activityLog.createMany({ data: ids.map((id) => ({ entityType: "requirement", entityId: id, action: "updated", actorId: session.id, message: target ? `规划到${target.name}` : "移出迭代" })) });
  return result({ ok: true, count: ids.length });
}

/** 看板用：项目当前进行中的迭代 */
export async function activeIteration(projectId: string) {
  return prisma.iteration.findFirst({ where: { projectId, status: "active" }, select: { id: true, name: true, startAt: true, endAt: true } });
}
