import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { bugWhere, canSeeProject, getAccess, projectWhere, requirementWhere } from "../access";
import { projectProgress } from "../shared/project-progress";
import { periodStart } from "../ai/quota";
import { result } from "../nova/result";

/** 本周一（服务器时区）的日期，用作周报的 weekStart */
export function weekOf(d = new Date()) {
  const s = periodStart("week", d);
  return new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 产品详情 · 项目：产品下我能看到的项目，带进度、未关闭 Bug、本周周报和定时发送设置 */
export async function loadProductProjects(session: SessionUser, productId: string) {
  const access = await getAccess(session);
  const projects = await prisma.project.findMany({ where: { productId, status: { not: "space" }, ...projectWhere(access) }, select: { id: true, name: true, key: true, iconUrl: true, status: true, plannedEndAt: true }, orderBy: { createdAt: "asc" } });
  const ids = projects.map((p) => p.id);
  const week = weekOf();
  const [prog, bugs, reports, schedules] = await Promise.all([
    projectProgress(ids),
    prisma.bug.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { in: ["open", "in_progress", "reopened"] }, AND: [bugWhere(access)] }, _count: { _all: true } }),
    prisma.projectReport.findMany({ where: { projectId: { in: ids } }, orderBy: { weekStart: "desc" }, take: 200 }),
    prisma.projectReportSchedule.findMany({ where: { projectId: { in: ids } } }),
  ]);
  const authors = await prisma.user.findMany({ where: { id: { in: Array.from(new Set(reports.map((r) => r.authorId))) } }, select: { id: true, name: true } });
  const out = [];
  for (const p of projects) {
    const pg = prog.get(p.id) || { done: 0, all: 0 };
    const mine = reports.filter((r) => r.projectId === p.id);
    const sch = schedules.find((s) => s.projectId === p.id);
    out.push({
      ...p,
      plannedEndAt: p.plannedEndAt?.toISOString() || null,
      progress: pg.all ? Math.round((pg.done / pg.all) * 100) : 0,
      reqDone: pg.done,
      reqAll: pg.all,
      openBugs: bugs.find((b) => b.projectId === p.id)?._count._all || 0,
      canEdit: await can(session, "project.edit", p.id),
      thisWeek: ymd(week),
      reports: mine.slice(0, 8).map((r) => ({ id: r.id, weekStart: ymd(r.weekStart), done: r.done, next: r.next, risks: r.risks, progress: r.progress, author: authors.find((a) => a.id === r.authorId)?.name || "—", updatedAt: r.updatedAt.toISOString() })),
      schedule: sch ? { enabled: sch.enabled, weekday: sch.weekday, hour: sch.hour, lastSentAt: sch.lastSentAt?.toISOString() || null } : { enabled: false, weekday: 5, hour: 17, lastSentAt: null },
    });
  }
  return out;
}

async function guard(session: SessionUser, projectId: string, write: boolean) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (write && !(await can(session, "project.edit", projectId))) return result({ error: "无权限编辑这个项目的周报" }, { status: 403 });
  return null;
}

/** 写 / 改某一周的周报：{ weekStart?: YYYY-MM-DD（默认本周）, done, next, risks, progress? } */
export async function saveReport(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const g = await guard(session, projectId, true);
  if (g) return g;
  const week = body.weekStart ? weekOf(new Date(`${String(body.weekStart)}T12:00:00`)) : weekOf();
  if (Number.isNaN(week.getTime())) return result({ error: "日期不对" }, { status: 400 });
  const clip = (v: unknown) => String(v ?? "").slice(0, 5000);
  const progress = body.progress === null || body.progress === "" || body.progress === undefined ? null : Math.max(0, Math.min(100, Math.round(Number(body.progress))));
  if (progress !== null && Number.isNaN(progress)) return result({ error: "进度要是 0～100 的数字" }, { status: 400 });
  const data = { done: clip(body.done), next: clip(body.next), risks: clip(body.risks), progress, authorId: session.id };
  const r = await prisma.projectReport.upsert({ where: { projectId_weekStart: { projectId, weekStart: week } }, create: { projectId, weekStart: week, ...data }, update: data });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "report_saved", actorId: session.id, message: `更新了 ${ymd(week)} 那周的周报` } });
  return result({ ok: true, id: r.id });
}

/** 按本周数据起草（不调用模型）：本周上线 / 推进的需求、解决的 Bug、逾期和高优 Bug 作为风险 */
export async function draftReport(session: SessionUser, projectId: string) {
  const g = await guard(session, projectId, false);
  if (g) return g;
  const access = await getAccess(session);
  const since = periodStart("week");
  const now = new Date();
  const [online, moved, fixed, overdue, severe, upcoming] = await Promise.all([
    prisma.requirement.findMany({ where: { projectId, status: "online", updatedAt: { gte: since }, AND: [requirementWhere(access)] }, select: { title: true }, take: 20 }),
    prisma.requirement.findMany({ where: { projectId, status: { notIn: ["online", "cancelled"] }, updatedAt: { gte: since }, AND: [requirementWhere(access)] }, select: { title: true }, take: 20 }),
    prisma.bug.count({ where: { projectId, status: { in: ["resolved", "closed"] }, updatedAt: { gte: since }, AND: [bugWhere(access)] } }),
    prisma.requirement.findMany({ where: { projectId, archivedAt: null, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { lt: now }, AND: [requirementWhere(access)] }, select: { title: true }, take: 10 }),
    prisma.bug.count({ where: { projectId, status: { in: ["open", "in_progress", "reopened"] }, severity: { in: ["blocker", "critical"] }, AND: [bugWhere(access)] } }),
    prisma.requirement.findMany({ where: { projectId, archivedAt: null, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { gte: now, lt: new Date(now.getTime() + 7 * 864e5) }, AND: [requirementWhere(access)] }, select: { title: true }, take: 10 }),
  ]);
  const list = (xs: { title: string }[]) => xs.map((x) => `- ${x.title}`).join("\n");
  return result({
    done: [online.length ? `已上线 ${online.length} 项：\n${list(online)}` : "", moved.length ? `推进中 ${moved.length} 项：\n${list(moved)}` : "", fixed ? `解决 Bug ${fixed} 个` : ""].filter(Boolean).join("\n") || "本周暂无变化",
    next: upcoming.length ? `下周计划完成：\n${list(upcoming)}` : "",
    risks: [overdue.length ? `逾期需求 ${overdue.length} 项：\n${list(overdue)}` : "", severe ? `未关闭的严重 / 阻塞 Bug ${severe} 个` : ""].filter(Boolean).join("\n"),
  });
}

/** 定时发送设置：{ enabled, weekday 1～7, hour 0～23 } */
export async function saveSchedule(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const g = await guard(session, projectId, true);
  if (g) return g;
  const weekday = Math.round(Number(body.weekday));
  const hour = Math.round(Number(body.hour));
  if (!(weekday >= 1 && weekday <= 7) || !(hour >= 0 && hour <= 23)) return result({ error: "请选择星期几和几点" }, { status: 400 });
  const enabled = body.enabled === true;
  await prisma.projectReportSchedule.upsert({ where: { projectId }, create: { projectId, enabled, weekday, hour }, update: { enabled, weekday, hour } });
  return result({ ok: true });
}

/** 定时任务每分钟调用：到点的项目把本周周报发给项目成员（每周只发一次）。返回要发的内容，由调用方投递 */
export async function dueReports(now = new Date()) {
  const wd = ((now.getDay() + 6) % 7) + 1;
  const list = await prisma.projectReportSchedule.findMany({ where: { enabled: true, weekday: wd, hour: { lte: now.getHours() } } });
  const out = [];
  const week = weekOf(now);
  for (const s of list) {
    if (s.lastSentAt && s.lastSentAt >= periodStart("week", now)) continue;
    const claimed = await prisma.projectReportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: s.lastSentAt }, data: { lastSentAt: now } });
    if (!claimed.count) continue;
    const [project, report, members] = await Promise.all([
      prisma.project.findUnique({ where: { id: s.projectId }, select: { name: true, productId: true } }),
      prisma.projectReport.findUnique({ where: { projectId_weekStart: { projectId: s.projectId, weekStart: week } } }),
      prisma.projectMember.findMany({ where: { projectId: s.projectId }, select: { userId: true } }),
    ]);
    if (!project) continue;
    out.push({ projectId: s.projectId, projectName: project.name, productId: project.productId, report, memberIds: members.map((m) => m.userId), week: ymd(week) });
  }
  return out;
}
