import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { requirementVisible } from "../access";
import { result } from "./result";
import { taskCodeOf } from "../shared/codes";
import { TASK_KINDS, TASK_KIND_LABEL, TASK_STATUS_LABEL, isTaskKind, isTaskStatus, type TaskKind, type TaskStatus } from "../shared/tasks-shared";

/**
 * 需求任务（T43）：设计 / 前端 / 后端 / 开发 / 测试 / 发布 / 其他。
 * - 看 = 能看需求；增删改 = 需求「编辑」权限；任务负责人自己可以改自己任务的状态。
 * - 负责人必须是项目成员（公共池需求不限）。
 * - 状态联动（只往前推，走 advanceRequirements，受停用状态、评审、关卡约束）：
 *   开发任务有人开始 → 需求「开发中」；开发任务全部完成 → 「开发完成」；测试任务全部完成 → 「测试完成」。
 * - 计划联动：需求的开始 / 截止改了，没开始的任务跟着平移（shiftTasks）。
 */

const DEV_KINDS: TaskKind[] = ["frontend", "backend", "dev"];
const DAY = 86400000;
/** 按日历加天数（跨夏令时也不会差一小时） */
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export type TaskRow = {
  id: string;
  code: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  startAt: string | null;
  dueAt: string | null;
  estimate: number | null;
  /** 三期 GitLab：关联的分支 / MR 摘要 */
  code_links?: string[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function reqFor(session: SessionUser, id: string) {
  if (!(await requirementVisible(session, id))) return null;
  return prisma.requirement.findFirst({ where: { id, deletedAt: null }, select: { id: true, projectId: true, status: true, title: true, startAt: true, plannedEndAt: true, workspaceId: true, archivedAt: true } });
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function validAssignee(projectId: string | null, userId: string | null) {
  if (!userId) return true;
  if (!projectId) return !!(await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } }));
  return !!(await prisma.projectMember.findFirst({ where: { projectId, userId, user: { isActive: true } }, select: { id: true } }));
}

export async function listTasks(session: SessionUser, id: string) {
  const r = await reqFor(session, id);
  if (!r) return null;
  const rows = await prisma.requirementTask.findMany({ where: { requirementId: id }, orderBy: [{ sortOrder: "asc" }, { number: "asc" }] });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((t) => t.assigneeId).filter((x): x is string => !!x) } }, select: { id: true, name: true, avatarUrl: true } });
  const tasks: TaskRow[] = rows.map((t) => ({
    id: t.id,
    code: taskCodeOf(t),
    kind: (isTaskKind(t.kind) ? t.kind : "other") as TaskKind,
    title: t.title,
    status: (isTaskStatus(t.status) ? t.status : "todo") as TaskStatus,
    assignee: users.find((u) => u.id === t.assigneeId) || null,
    startAt: iso(t.startAt),
    dueAt: iso(t.dueAt),
    estimate: t.estimate,
  }));
  return { tasks, canEdit: !r.archivedAt && (await can(session, "requirements.edit", r.projectId)) };
}

function cleanFields(body: Record<string, unknown>) {
  const out: { kind?: TaskKind; title?: string; assigneeId?: string | null; startAt?: Date | null; dueAt?: Date | null; estimate?: number | null; status?: TaskStatus } = {};
  if (body.kind !== undefined) {
    if (!isTaskKind(body.kind)) throw new Error("任务类型不对");
    out.kind = body.kind;
  }
  if (body.title !== undefined) {
    const t = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!t) throw new Error("请填写任务标题");
    out.title = t;
  }
  if (body.assigneeId !== undefined) out.assigneeId = body.assigneeId ? String(body.assigneeId) : null;
  for (const k of ["startAt", "dueAt"] as const) {
    if (body[k] === undefined) continue;
    const d = parseDate(body[k]);
    if (d === undefined) throw new Error("日期格式不对");
    out[k] = d;
  }
  if (body.estimate !== undefined) {
    const n = body.estimate === null || body.estimate === "" ? null : Number(body.estimate);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10000)) throw new Error("预估工时要在 0–10000 小时之间");
    out.estimate = n === null ? null : Math.round(n * 10) / 10;
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) throw new Error("任务状态不对");
    out.status = body.status;
  }
  if (out.startAt && out.dueAt && out.startAt > out.dueAt) throw new Error("开始日期不能晚于截止日期");
  return out;
}

async function log(actorId: string, reqId: string, message: string) {
  await prisma.activityLog.create({ data: { entityType: "requirement", entityId: reqId, action: "updated", actorId, message } });
}

export async function createTask(session: SessionUser, id: string, body: Record<string, unknown>) {
  const r = await reqFor(session, id);
  if (!r) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  if (r.archivedAt) return result({ error: "需求已归档" }, { status: 400 });
  let f;
  try {
    f = cleanFields({ kind: "dev", ...body });
  } catch (e) {
    return result({ error: (e as Error).message }, { status: 400 });
  }
  if (!f.title) return result({ error: "请填写任务标题" }, { status: 400 });
  if (!(await validAssignee(r.projectId, f.assigneeId ?? null))) return result({ error: "负责人要是项目成员" }, { status: 400 });
  const n = await prisma.requirementTask.count({ where: { requirementId: id } });
  if (n >= 100) return result({ error: "每条需求最多 100 个任务" }, { status: 400 });
  const t = await prisma.requirementTask.create({
    data: { workspaceId: r.workspaceId, requirementId: id, kind: f.kind!, title: f.title, assigneeId: f.assigneeId ?? null, startAt: f.startAt ?? null, dueAt: f.dueAt ?? null, estimate: f.estimate ?? null, status: f.status ?? "todo", doneAt: f.status === "done" ? new Date() : null, sortOrder: n, createdById: session.id },
  });
  await log(session.id, id, `添加任务 ${taskCodeOf(t)}「${t.title}」`);
  if (f.status && f.status !== "todo") await syncRequirementStatus(session.id, id);
  return result({ id: t.id, code: taskCodeOf(t) });
}

/** 按模板一次生成：设计（启用设计环节时）/ 前端 / 后端 / 测试 / 发布，日期按需求的开始—截止切分 */
export async function generateTasks(session: SessionUser, id: string, body: Record<string, unknown>) {
  const r = await reqFor(session, id);
  if (!r) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  const kinds = (Array.isArray(body.kinds) ? body.kinds : ["frontend", "backend", "test", "release"]).filter(isTaskKind).slice(0, 8) as TaskKind[];
  if (!kinds.length) return result({ error: "请选择要生成的任务类型" }, { status: 400 });
  const existing = new Set((await prisma.requirementTask.findMany({ where: { requirementId: id }, select: { kind: true } })).map((t) => t.kind));
  const todo = kinds.filter((k) => !existing.has(k));
  if (!todo.length) return result({ ok: true, created: 0 });
  const plan = splitPlan(r.startAt, r.plannedEndAt, todo);
  const n = await prisma.requirementTask.count({ where: { requirementId: id } });
  for (let i = 0; i < todo.length; i++) {
    const k = todo[i];
    await prisma.requirementTask.create({ data: { workspaceId: r.workspaceId, requirementId: id, kind: k, title: `${TASK_KIND_LABEL[k]}：${r.title}`.slice(0, 200), startAt: plan[i].start, dueAt: plan[i].due, sortOrder: n + i, createdById: session.id } });
  }
  await log(session.id, id, `按模板生成 ${todo.length} 个任务`);
  return result({ ok: true, created: todo.length });
}

/** 日期切分：设计 / 开发类并行占前 60%，测试占接着的 30%，发布在截止日；没有日期就都留空 */
export function splitPlan(start: Date | null, end: Date | null, kinds: TaskKind[]) {
  if (!start || !end || end < start) return kinds.map(() => ({ start: null as Date | null, due: (end ?? null) as Date | null }));
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
  const at = (p: number) => addDays(start, Math.round(span * p));
  return kinds.map((k) => {
    if (k === "design") return { start, due: at(0.2) };
    if (k === "frontend" || k === "backend" || k === "dev") return { start: at(kinds.includes("design") ? 0.2 : 0), due: at(0.6) };
    if (k === "test") return { start: at(0.6), due: at(0.9) };
    if (k === "release") return { start: end, due: end };
    return { start, due: end };
  });
}

export async function updateTask(session: SessionUser, id: string, taskId: string, body: Record<string, unknown>) {
  const r = await reqFor(session, id);
  const t = r ? await prisma.requirementTask.findFirst({ where: { id: taskId, requirementId: id } }) : null;
  if (!r || !t) return result({ error: "任务不存在" }, { status: 404 });
  let f;
  try {
    f = cleanFields(body);
  } catch (e) {
    return result({ error: (e as Error).message }, { status: 400 });
  }
  const canEdit = await can(session, "requirements.edit", r.projectId);
  // 任务负责人只能改自己任务的状态
  const onlyStatus = Object.keys(f).every((k) => k === "status");
  if (!canEdit && !(onlyStatus && t.assigneeId === session.id)) return result({ error: "没有编辑这个任务的权限" }, { status: 403 });
  if (r.archivedAt) return result({ error: "需求已归档" }, { status: 400 });
  if (f.assigneeId !== undefined && !(await validAssignee(r.projectId, f.assigneeId))) return result({ error: "负责人要是项目成员" }, { status: 400 });
  const start = f.startAt !== undefined ? f.startAt : t.startAt;
  const due = f.dueAt !== undefined ? f.dueAt : t.dueAt;
  if (start && due && start > due) return result({ error: "开始日期不能晚于截止日期" }, { status: 400 });
  const data: Record<string, unknown> = { ...f };
  if (f.status && f.status !== t.status) data.doneAt = f.status === "done" ? new Date() : null;
  await prisma.requirementTask.update({ where: { id: t.id }, data });
  if (f.status && f.status !== t.status) {
    await log(session.id, id, `任务 ${taskCodeOf(t)} ${TASK_STATUS_LABEL[t.status as TaskStatus] || t.status} → ${TASK_STATUS_LABEL[f.status]}`);
    await syncRequirementStatus(session.id, id);
  }
  return result({ ok: true });
}

export async function deleteTask(session: SessionUser, id: string, taskId: string) {
  const r = await reqFor(session, id);
  const t = r ? await prisma.requirementTask.findFirst({ where: { id: taskId, requirementId: id } }) : null;
  if (!r || !t) return result({ error: "任务不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  await prisma.requirementTask.delete({ where: { id: t.id } });
  await log(session.id, id, `删除任务 ${taskCodeOf(t)}「${t.title}」`);
  return result({ ok: true });
}

/** 任务状态 → 需求状态（只往前推；系统动作也会调，如三期 GitLab 合并后） */
export async function syncRequirementStatus(actorId: string | null, id: string) {
  const r = await prisma.requirement.findUnique({ where: { id }, select: { status: true } });
  if (!r) return;
  const ts = await prisma.requirementTask.findMany({ where: { requirementId: id, status: { not: "cancelled" } }, select: { kind: true, status: true } });
  const dev = ts.filter((t) => (DEV_KINDS as string[]).includes(t.kind));
  const test = ts.filter((t) => t.kind === "test");
  const { advanceRequirements } = await import("./flow");
  if (dev.length && dev.every((t) => t.status === "done") && r.status.startsWith("dev")) await advanceRequirements(actorId, [id], "dev_done", "开发任务全部完成");
  else if (dev.some((t) => t.status === "doing" || t.status === "done") && r.status === "dev_todo") await advanceRequirements(actorId, [id], "dev_in_progress", "开发任务已开始");
  if (test.length && test.every((t) => t.status === "done") && r.status.startsWith("test")) await advanceRequirements(actorId, [id], "test_done", "测试任务全部完成");
}

/** 需求开始 / 截止改了：没开始的任务按同样的天数平移（先看开始日的变化，没有再看截止日） */
export async function shiftTasks(actorId: string, id: string, before: { startAt: Date | null; plannedEndAt: Date | null }, after: { startAt?: Date | null; plannedEndAt?: Date | null }) {
  const delta =
    after.startAt !== undefined && before.startAt && after.startAt
      ? after.startAt.getTime() - before.startAt.getTime()
      : after.plannedEndAt !== undefined && before.plannedEndAt && after.plannedEndAt
        ? after.plannedEndAt.getTime() - before.plannedEndAt.getTime()
        : 0;
  if (!delta) return { count: 0, days: 0 };
  const days = Math.round(delta / DAY);
  if (!days) return { count: 0, days: 0 };
  const ts = await prisma.requirementTask.findMany({ where: { requirementId: id, status: "todo", OR: [{ startAt: { not: null } }, { dueAt: { not: null } }] } });
  for (const t of ts) {
    await prisma.requirementTask.update({ where: { id: t.id }, data: { startAt: t.startAt ? addDays(t.startAt, days) : null, dueAt: t.dueAt ? addDays(t.dueAt, days) : null } });
  }
  if (ts.length) await log(actorId, id, `计划调整 ${delta > 0 ? "后移" : "提前"} ${Math.abs(days)} 天，${ts.length} 个未开始的任务一起平移`);
  return { count: ts.length, days };
}

/** 撤销平移：再平移回去 */
export async function unshiftTasks(session: SessionUser, id: string, days: number) {
  const r = await reqFor(session, id);
  if (!r) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  const n = Math.round(days);
  if (!n || Math.abs(n) > 365) return result({ error: "天数不对" }, { status: 400 });
  const ts = await prisma.requirementTask.findMany({ where: { requirementId: id, status: "todo" } });
  for (const t of ts) await prisma.requirementTask.update({ where: { id: t.id }, data: { startAt: t.startAt ? addDays(t.startAt, n) : null, dueAt: t.dueAt ? addDays(t.dueAt, n) : null } });
  return result({ ok: true, shifted: ts.length });
}

/** 计划汇总（需求详情「计划」）：开发 / 测试 / 发布 + 冲突 */
export async function requirementPlan(session: SessionUser, id: string) {
  const r = await reqFor(session, id);
  if (!r) return null;
  const [tasks, kids, items] = await Promise.all([
    prisma.requirementTask.findMany({ where: { OR: [{ requirementId: id }, { requirement: { parentId: id, deletedAt: null } }], status: { not: "cancelled" } }, select: { kind: true, status: true, startAt: true, dueAt: true } }),
    prisma.requirement.count({ where: { parentId: id, deletedAt: null } }),
    prisma.releaseRequirement.findMany({ where: { requirementId: id, release: { status: { notIn: ["cancelled"] } } }, include: { release: { select: { id: true, version: true, plannedAt: true, releasedAt: true, status: true, projectId: true } } } }),
  ]);
  const span = (ks: string[]) => {
    const ts = tasks.filter((t) => ks.includes(t.kind));
    const starts = ts.map((t) => t.startAt).filter((d): d is Date => !!d);
    const dues = ts.map((t) => t.dueAt).filter((d): d is Date => !!d);
    return {
      count: ts.length,
      done: ts.filter((t) => t.status === "done").length,
      start: starts.length ? iso(new Date(Math.min(...starts.map((d) => d.getTime())))) : null,
      due: dues.length ? iso(new Date(Math.max(...dues.map((d) => d.getTime())))) : null,
    };
  };
  const dev = span(["design", ...DEV_KINDS]);
  const test = span(["test"]);
  const rel = items.map((i) => i.release).sort((a, b) => (a.plannedAt?.getTime() ?? 0) - (b.plannedAt?.getTime() ?? 0))[0] || null;
  const latest = [r.plannedEndAt, ...tasks.filter((t) => t.kind !== "release").map((t) => t.dueAt)].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
  let conflict: { latest: string; next: { id: string; version: string; plannedAt: string | null } | null } | null = null;
  if (rel && rel.plannedAt && rel.status !== "released" && latest && latest > new Date(rel.plannedAt.getTime() + DAY - 1)) {
    const next = await prisma.release.findFirst({ where: { projectId: rel.projectId, status: { in: ["planning", "frozen"] }, plannedAt: { gte: latest }, id: { not: rel.id } }, orderBy: { plannedAt: "asc" }, select: { id: true, version: true, plannedAt: true } });
    conflict = { latest: latest.toISOString(), next: next ? { id: next.id, version: next.version, plannedAt: iso(next.plannedAt) } : null };
  }
  return {
    dev,
    test,
    release: rel ? { id: rel.id, version: rel.version, plannedAt: iso(rel.plannedAt), released: rel.status === "released" } : null,
    conflict,
    children: kids,
    canEdit: await can(session, "requirements.edit", r.projectId),
  };
}

/** 连同子需求从当前发版挪到另一个发版（同项目、没上线的） */
export async function moveToRelease(session: SessionUser, id: string, body: Record<string, unknown>) {
  const r = await reqFor(session, id);
  if (!r) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", r.projectId)) && !(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有调整发版的权限" }, { status: 403 });
  const to = await prisma.release.findFirst({ where: { id: String(body.releaseId || ""), projectId: r.projectId ?? "__none__", status: { in: ["planning", "frozen"] } }, select: { id: true, version: true } });
  if (!to) return result({ error: "目标发版不存在或已上线" }, { status: 404 });
  const kids = (await prisma.requirement.findMany({ where: { parentId: id, deletedAt: null, status: { notIn: ["online", "cancelled"] } }, select: { id: true } })).map((k) => k.id);
  const ids = [id, ...kids];
  await prisma.$transaction([
    prisma.releaseRequirement.deleteMany({ where: { requirementId: { in: ids }, releaseId: { not: to.id }, release: { status: { in: ["planning", "frozen"] } } } }),
    ...ids.map((rid) => prisma.releaseRequirement.upsert({ where: { releaseId_requirementId: { releaseId: to.id, requirementId: rid } }, create: { releaseId: to.id, requirementId: rid }, update: {} })),
  ]);
  await log(session.id, id, `连同 ${kids.length} 条子需求挪到发版 ${to.version}`);
  return result({ ok: true, moved: ids.length, version: to.version });
}

export { TASK_KINDS };

/** 我的任务（工作台卡片、开放接口 GET tasks?mine=1）：指派给我、没完成的，按截止日排；看不到的需求里的任务不返回 */
export async function myTasks(session: SessionUser, opts: { all?: boolean; take?: number } = {}) {
  const { getAccess, requirementWhere } = await import("../access");
  const access = await getAccess(session);
  const rows = await prisma.requirementTask.findMany({
    where: { assigneeId: session.id, ...(opts.all ? {} : { status: { in: ["todo", "doing"] } }), requirement: { deletedAt: null, archivedAt: null, AND: [requirementWhere(access)] } },
    include: { requirement: { select: { id: true, number: true, title: true, status: true, project: { select: { id: true, name: true } } } } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { number: "asc" }],
    take: Math.min(Math.max(opts.take ?? 50, 1), 200),
  });
  return rows.map((t) => ({
    id: t.id,
    code: taskCodeOf(t),
    kind: t.kind,
    title: t.title,
    status: t.status,
    startAt: iso(t.startAt),
    dueAt: iso(t.dueAt),
    estimate: t.estimate,
    requirement: { id: t.requirement.id, code: `R${t.requirement.number}`, title: t.requirement.title, status: t.requirement.status },
    project: t.requirement.project,
  }));
}
