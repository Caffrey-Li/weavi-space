import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { endOfDay, endOfWeek, startOfDay, startOfWeek, subDays } from "date-fns";
import { bugWhere, getAccess, projectWhere, requirementWhere, type Access } from "../access";
import { projectProgress } from "../shared/project-progress";
import { REQ_STATUS } from "../shared/constants";
import { reqCodeOf, taskCodeOf } from "../shared/codes";
import { weekOf } from "../reports/service";
import {
  WB_ROLE_LABEL,
  mergeInbox,
  mergeSide,
  pickButtons,
  pickKpis,
  roleOfPosition,
  roleOfTaskKind,
  rolesFor,
  type InboxItem,
  type Urgency,
  type WbButton,
  type WbKpi,
  type WbRole,
} from "./roles";

/**
 * 按角色重做的工作台（11-22）：问候 + 4 指标 + 待我处理 + 角色主区块 + 侧栏。
 * 身兼多岗时多个角色合在一页（规则见 ./roles.ts）；每个角色的数据只取他担任这个岗位的项目。
 * 所有查询都在本人数据范围（access.ts）内。
 */

export type WbRow = { id: string; title: string; href: string; meta: string; tag?: string; tone?: "danger" | "warning" | "info" | "neutral"; progress?: number; action?: { label: string; href: string } };
export type WbBlock = { key: string; role: WbRole; title: string; count: number; more?: { label: string; href: string }; rows: WbRow[]; empty: string };
export type WbSideCard = { key: string; title: string; rows: WbRow[]; more?: { label: string; href: string } };
export type RoleWorkbench = {
  roles: WbRole[];
  /** 每个角色担任的项目名（问候下面那句「你在 A 是产品经理，在 B 是项目经理」） */
  roleProjects: { role: WbRole; projects: string[] }[];
  kpis: WbKpi[];
  inbox: InboxItem[];
  blocks: WbBlock[];
  side: WbSideCard[];
  buttons: WbButton[];
};

type Ctx = {
  user: SessionUser;
  access: Access;
  now: Date;
  today: Date;
  todayEnd: Date;
  weekStart: Date;
  weekEnd: Date;
  /** 每个角色的项目范围；null = 全部能看到的项目 */
  scope: Map<WbRole, string[] | null>;
  /** 项目 → 我在里面的角色（项目内岗位） */
  projectRole: Map<string, WbRole>;
  primary: WbRole;
  readonly: boolean;
};

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const md = (d: Date) => `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
const reqLabel = (s: string) => REQ_STATUS.find((x) => x.key === s)?.label || s;
const daysAgo = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 864e5));

function urgencyOfDue(c: Ctx, due: Date | null | undefined, fallback: Urgency = 3): Urgency {
  if (!due) return fallback;
  if (due < c.today) return 0;
  if (due <= c.todayEnd) return 1;
  if (due <= c.weekEnd) return 2;
  return fallback;
}

/** 这件事在某个项目里时，标我在那个项目的角色；我在那里没岗位就标第一个角色 */
function roleIn(c: Ctx, projectId: string | null | undefined, prefer?: WbRole): WbRole {
  if (prefer && c.scope.has(prefer)) return prefer;
  return (projectId && c.projectRole.get(projectId)) || c.primary;
}

function projectFilter(c: Ctx, role: WbRole) {
  const ids = c.scope.get(role);
  return ids === null || ids === undefined ? {} : { projectId: { in: ids.length ? ids : ["__none__"] } };
}

async function buildCtx(user: SessionUser, now: Date): Promise<Ctx> {
  const access = await getAccess(user);
  const [me, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { position: true } }),
    prisma.projectMember.findMany({ where: { userId: user.id, project: { status: "active" } }, select: { projectId: true, role: true } }),
  ]);
  const roles = rolesFor(user.globalRole, me?.position, members.map((m) => m.role));
  const projectRole = new Map<string, WbRole>();
  const byRole = new Map<WbRole, string[]>();
  for (const m of members) {
    const r = roleOfPosition(m.role);
    if (!r) continue;
    projectRole.set(m.projectId, r);
    byRole.set(r, [...(byRole.get(r) || []), m.projectId]);
  }
  const allMine = members.map((m) => m.projectId);
  const scope = new Map<WbRole, string[] | null>();
  for (const r of roles) {
    if (r === "manager" || r === "admin") scope.set(r, null);
    // 只来自默认岗位（项目里没挂这个岗位）时，取我参与的全部项目
    else scope.set(r, byRole.get(r) || allMine);
  }
  return {
    user,
    access,
    now,
    today: startOfDay(now),
    todayEnd: endOfDay(now),
    weekStart: startOfWeek(now, { weekStartsOn: 1 }),
    weekEnd: endOfWeek(now, { weekStartsOn: 1 }),
    scope,
    projectRole,
    primary: roles[0],
    readonly: Boolean(user.isDemo) || user.globalRole === "guest",
  };
}

/* ---------------- 待我处理 ---------------- */

async function commonInbox(c: Ctx): Promise<InboxItem[]> {
  const rq = requirementWhere(c.access);
  const [votes, agents, tasks, conditions] = await Promise.all([
    // 评审等我投票
    prisma.reviewVote.findMany({ where: { userId: c.user.id, verdict: "pending", review: { status: "open" } }, include: { review: true }, orderBy: { review: { createdAt: "asc" } }, take: 20 }),
    // 小围（Agent）等我确认
    prisma.agentTask.findMany({ where: { userId: c.user.id, status: "waiting" }, select: { id: true, goal: true, updatedAt: true, projectId: true }, orderBy: { updatedAt: "asc" }, take: 10 }),
    // 指派给我的任务：逾期、今天、本周到期的
    prisma.requirementTask.findMany({
      where: { assigneeId: c.user.id, status: { in: ["todo", "doing"] }, dueAt: { lte: c.weekEnd }, requirement: { deletedAt: null, archivedAt: null, AND: [rq] } },
      include: { requirement: { select: { id: true, number: true, title: true, projectId: true } } },
      orderBy: { dueAt: "asc" },
      take: 20,
    }),
    // 我发起的评审有条件通过，条件还没落实
    prisma.reviewVote.findMany({ where: { verdict: "conditional", resolvedAt: null, review: { status: "approved", createdById: c.user.id } }, include: { review: true }, take: 10 }),
  ]);
  const out: InboxItem[] = [];
  for (const v of votes) {
    const r = v.review;
    const due = r.dueAt;
    out.push({
      key: `review:${r.id}`,
      role: roleIn(c, r.projectId),
      kind: "评审等我",
      tone: "info",
      title: r.title,
      meta: `第 ${r.round} 轮${due ? ` · ${due < c.today ? "已过截止" : `${md(due)} 截止`}` : ""}`,
      href: r.requirementId ? `/requirements/${r.requirementId}#rq-review` : r.docPageId && r.projectId ? `/docs/${r.projectId}/pages/${r.docPageId}` : "/notifications",
      action: "去评审",
      // 评审等我投票 = 卡着发起人
      urgency: 0,
      at: r.createdAt.toISOString(),
    });
  }
  for (const a of agents)
    out.push({ key: `agent:${a.id}`, role: roleIn(c, a.projectId), kind: "小围等确认", tone: "warning", title: a.goal.slice(0, 80), meta: `${md(a.updatedAt)} 起在等你确认`, href: `/ai/tasks/${a.id}`, action: "确认", urgency: 0, at: a.updatedAt.toISOString() });
  for (const t of tasks)
    out.push({
      key: `task:${t.id}`,
      role: roleIn(c, t.requirement.projectId, roleOfTaskKind(t.kind)),
      kind: t.dueAt && t.dueAt < c.today ? "任务逾期" : "任务到期",
      tone: t.dueAt && t.dueAt < c.today ? "danger" : "neutral",
      title: `${taskCodeOf(t)} ${t.title}`,
      meta: `${reqCodeOf(t.requirement)} ${t.requirement.title}${t.dueAt ? ` · 截止 ${md(t.dueAt)}` : ""}`,
      href: `/requirements/${t.requirement.id}#rq-tasks`,
      action: "查看",
      urgency: urgencyOfDue(c, t.dueAt),
      at: t.dueAt?.toISOString(),
    });
  const seen = new Set<string>();
  const voters = new Map((await prisma.user.findMany({ where: { id: { in: conditions.map((v) => v.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  for (const v of conditions) {
    if (seen.has(v.reviewId)) continue;
    seen.add(v.reviewId);
    const r = v.review;
    out.push({
      key: `cond:${r.id}`,
      role: roleIn(c, r.projectId, "product"),
      kind: "条件待落实",
      tone: "warning",
      title: r.title,
      meta: `${voters.get(v.userId) || "评审人"}：${(v.comment || "有条件通过").slice(0, 60)}`,
      href: r.requirementId ? `/requirements/${r.requirementId}#rq-review` : r.docPageId && r.projectId ? `/docs/${r.projectId}/pages/${r.docPageId}` : "/notifications",
      action: "落实",
      urgency: 2,
      at: r.closedAt?.toISOString(),
    });
  }
  return out;
}

async function productInbox(c: Ctx): Promise<InboxItem[]> {
  const pf = projectFilter(c, "product");
  const [drafts, rejected] = await Promise.all([
    prisma.delivery.findMany({ where: { prdStatus: "draft", createdById: c.user.id, ...pf }, select: { id: true, projectId: true, prdPageId: true, sourcePageId: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 10 }),
    prisma.review.findMany({ where: { status: "rejected", createdById: c.user.id, closedAt: { gte: subDays(c.now, 14) }, ...pf }, select: { id: true, title: true, round: true, projectId: true, requirementId: true, docPageId: true, closedAt: true }, take: 10 }),
  ]);
  const pages = await prisma.docPage.findMany({ where: { id: { in: drafts.map((d) => d.prdPageId || d.sourcePageId) } }, select: { id: true, title: true } });
  const titleOf = new Map(pages.map((p) => [p.id, p.title]));
  const out: InboxItem[] = [];
  for (const d of drafts) {
    const page = d.prdPageId || d.sourcePageId;
    out.push({ key: `prd:${d.id}`, role: "product", kind: "PRD 待确认", tone: "info", title: `${titleOf.get(page) || "PRD"}`, meta: "小围已生成，确认后锁版本并拆实现需求", href: `/docs/${d.projectId}/pages/${page}`, action: "去确认", urgency: 1, at: d.updatedAt.toISOString() });
  }
  for (const r of rejected) {
    // 退回后已经重新发起的不算
    const again = await prisma.review.findFirst({ where: { round: { gt: r.round }, ...(r.requirementId ? { requirementId: r.requirementId } : { docPageId: r.docPageId }) }, select: { id: true } });
    if (again) continue;
    out.push({ key: `reject:${r.id}`, role: "product", kind: "评审退回", tone: "danger", title: r.title, meta: `第 ${r.round} 轮不通过`, href: r.requirementId ? `/requirements/${r.requirementId}#rq-review` : `/docs/${r.projectId}/pages/${r.docPageId}`, action: "看意见", urgency: 0, at: r.closedAt?.toISOString() });
  }
  return out;
}

async function devInbox(c: Ctx): Promise<InboxItem[]> {
  const bugs = await prisma.bug.findMany({
    where: { status: "reopened", archivedAt: null, OR: [{ assigneeId: c.user.id }, { frontendId: c.user.id }, { backendId: c.user.id }], AND: [bugWhere(c.access)] },
    select: { id: true, title: true, reopenCount: true, projectId: true, updatedAt: true, project: { select: { name: true } } },
    take: 10,
  });
  return bugs.map((b) => ({ key: `bug:${b.id}`, role: roleIn(c, b.projectId, "dev"), kind: "Bug 被退回", tone: "danger" as const, title: b.title, meta: `${b.project?.name || ""} · 第 ${b.reopenCount} 次退回`, href: `/bugs/${b.id}`, action: "处理", urgency: 0 as Urgency, at: b.updatedAt.toISOString() }));
}

async function qaInbox(c: Ctx): Promise<InboxItem[]> {
  const runs = await prisma.deliveryRun.findMany({
    where: { status: { in: ["manual", "done"] }, finalizedAt: null, createdById: c.user.id, kind: "round" },
    select: { id: true, status: true, round: true, deliveryId: true, total: true, doneCount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const dels = await prisma.delivery.findMany({ where: { id: { in: runs.map((r) => r.deliveryId) } }, select: { id: true, projectId: true, sourcePageId: true, casesPageId: true } });
  const pages = await prisma.docPage.findMany({ where: { id: { in: dels.map((d) => d.sourcePageId) } }, select: { id: true, title: true } });
  return runs.flatMap((r) => {
    const d = dels.find((x) => x.id === r.deliveryId);
    if (!d) return [];
    const title = pages.find((p) => p.id === d.sourcePageId)?.title || "测试轮次";
    const manual = r.status === "manual";
    return [{ key: `run:${r.id}`, role: roleIn(c, d.projectId, "qa"), kind: manual ? "填手工结果" : "完成本轮", tone: manual ? ("warning" as const) : ("info" as const), title: `${title} · 第 ${r.round} 轮`, meta: manual ? `还有 ${Math.max(0, r.total - r.doneCount)} 条等手工结果` : "已跑完，等你完成本轮出报告", href: `/docs/${d.projectId}/pages/${d.casesPageId || d.sourcePageId}`, action: manual ? "去填写" : "完成本轮", urgency: (manual ? 0 : 1) as Urgency, at: r.createdAt.toISOString() }];
  });
}

async function techInbox(c: Ctx): Promise<InboxItem[]> {
  const rows = await prisma.requirement.findMany({
    where: { status: "dev_todo", archivedAt: null, deletedAt: null, tasks: { none: {} }, ...projectFilter(c, "tech_lead"), AND: [requirementWhere(c.access)] },
    select: { id: true, number: true, title: true, plannedEndAt: true, project: { select: { name: true } } },
    orderBy: [{ plannedEndAt: { sort: "asc", nulls: "last" } }],
    take: 8,
  });
  return rows.map((r) => ({ key: `split:${r.id}`, role: "tech_lead" as WbRole, kind: "待拆任务", tone: "neutral" as const, title: `${reqCodeOf(r)} ${r.title}`, meta: `${r.project?.name || ""}${r.plannedEndAt ? ` · 计划 ${ymd(r.plannedEndAt)}` : ""}`, href: `/requirements/${r.id}#rq-tasks`, action: "拆任务", urgency: urgencyOfDue(c, r.plannedEndAt, 2), at: r.plannedEndAt?.toISOString() }));
}

async function pmInbox(c: Ctx): Promise<InboxItem[]> {
  const ids = c.scope.get("pm") || [];
  if (!ids.length) return [];
  const week = weekOf(c.now);
  const [projects, reports] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: ids }, status: "active" }, select: { id: true, name: true, productId: true } }),
    prisma.projectReport.findMany({ where: { projectId: { in: ids }, weekStart: week }, select: { projectId: true } }),
  ]);
  const has = new Set(reports.map((r) => r.projectId));
  // 周四起没写的算「今天」，之前算「本周」
  const urgency: Urgency = c.now.getDay() >= 4 || c.now.getDay() === 0 ? 1 : 2;
  return projects
    .filter((p) => !has.has(p.id))
    .map((p) => ({ key: `report:${p.id}`, role: "pm" as WbRole, kind: "周报", tone: "neutral" as const, title: `${p.name} · 本周周报`, meta: "还没写，可以按本周数据起草", href: p.productId ? `/products/${p.productId}?tab=projects` : `/projects/${p.id}`, action: "写周报", urgency, at: null }));
}

async function businessInbox(c: Ctx): Promise<InboxItem[]> {
  const rows = await prisma.requirement.findMany({
    where: { status: "test_done", archivedAt: null, deletedAt: null, OR: [{ proposerId: c.user.id }, { proposerId: null, creatorId: c.user.id }], AND: [requirementWhere(c.access)] },
    select: { id: true, number: true, title: true, updatedAt: true, project: { select: { name: true } } },
    take: 10,
  });
  return rows.map((r) => ({ key: `accept:${r.id}`, role: "business" as WbRole, kind: "待验收", tone: "info" as const, title: `${reqCodeOf(r)} ${r.title}`, meta: `${r.project?.name || ""} · 测试完成，等你确认`, href: `/requirements/${r.id}`, action: "验收", urgency: 1 as Urgency, at: r.updatedAt.toISOString() }));
}

const ROLE_INBOX: Partial<Record<WbRole, (c: Ctx) => Promise<InboxItem[]>>> = { business: businessInbox, product: productInbox, tech_lead: techInbox, dev: devInbox, qa: qaInbox, pm: pmInbox };

export async function loadInbox(c: Ctx): Promise<InboxItem[]> {
  const roles = Array.from(c.scope.keys());
  const lists = await Promise.all([commonInbox(c), ...roles.map((r) => ROLE_INBOX[r]?.(c) ?? Promise.resolve([]))]);
  return mergeInbox(lists.flat());
}

/* ---------------- 各角色指标 / 主区块 / 侧栏 / 按钮 ---------------- */

type RolePart = { kpis: WbKpi[]; block: WbBlock | null; side: WbSideCard[]; buttons: WbButton[] };

async function releasesCard(c: Ctx, ids: string[] | null): Promise<WbSideCard> {
  const rows = await prisma.release.findMany({
    where: { status: { in: ["planning", "frozen", "releasing"] }, plannedAt: { gte: c.today }, ...(ids ? { projectId: { in: ids.length ? ids : ["__none__"] } } : { project: projectWhere(c.access) }) },
    select: { id: true, version: true, plannedAt: true, project: { select: { name: true } } },
    orderBy: { plannedAt: "asc" },
    take: 5,
  });
  return { key: "releases", title: "近期上线计划", rows: rows.map((r) => ({ id: r.id, title: `${r.project.name} v${r.version}`, href: `/releases/${r.id}`, meta: r.plannedAt ? ymd(r.plannedAt) : "" })) };
}

async function scheduleCard(c: Ctx): Promise<WbSideCard> {
  const rq = requirementWhere(c.access);
  const [reqs, tasks, reviews] = await Promise.all([
    prisma.requirement.findMany({ where: { archivedAt: null, deletedAt: null, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { gte: c.today, lte: c.weekEnd }, assignees: { some: { userId: c.user.id } }, AND: [rq] }, select: { id: true, number: true, title: true, plannedEndAt: true }, take: 6 }),
    prisma.requirementTask.findMany({ where: { assigneeId: c.user.id, status: { in: ["todo", "doing"] }, dueAt: { gte: c.today, lte: c.weekEnd } }, select: { id: true, number: true, title: true, dueAt: true, requirementId: true }, take: 6 }),
    prisma.review.findMany({ where: { status: "open", dueAt: { gte: c.today, lte: c.weekEnd }, OR: [{ createdById: c.user.id }, { votes: { some: { userId: c.user.id } } }] }, select: { id: true, title: true, dueAt: true, requirementId: true }, take: 4 }),
  ]);
  const rows: (WbRow & { at: number })[] = [
    ...reqs.map((r) => ({ id: `r${r.id}`, title: `「${r.title}」计划完成`, href: `/requirements/${r.id}`, meta: md(r.plannedEndAt!), at: r.plannedEndAt!.getTime() })),
    ...tasks.map((t) => ({ id: `t${t.id}`, title: `${taskCodeOf(t)} ${t.title} 截止`, href: `/requirements/${t.requirementId}#rq-tasks`, meta: md(t.dueAt!), at: t.dueAt!.getTime() })),
    ...reviews.map((r) => ({ id: `v${r.id}`, title: `「${r.title}」评审截止`, href: r.requirementId ? `/requirements/${r.requirementId}#rq-review` : "/notifications", meta: md(r.dueAt!), at: r.dueAt!.getTime() })),
  ].sort((a, b) => a.at - b.at);
  return { key: "schedule", title: "本周日程", rows: rows.slice(0, 6).map((r) => ({ id: r.id, title: r.title, href: r.href, meta: r.meta })) };
}

async function businessPart(c: Ctx): Promise<RolePart> {
  const rq = requirementWhere(c.access);
  const mine = { archivedAt: null, deletedAt: null, OR: [{ proposerId: c.user.id }, { proposerId: null, creatorId: c.user.id }], AND: [rq] };
  const [active, online, accept, bugs, rows] = await Promise.all([
    prisma.requirement.count({ where: { ...mine, status: { notIn: ["online", "cancelled"] } } }),
    prisma.requirement.count({ where: { ...mine, status: "online", actualEndAt: { gte: new Date(c.now.getFullYear(), c.now.getMonth(), 1) } } }),
    prisma.requirement.count({ where: { ...mine, status: "test_done" } }),
    prisma.bug.count({ where: { creatorId: c.user.id, archivedAt: null, status: { in: ["open", "in_progress", "reopened"] }, AND: [bugWhere(c.access)] } }),
    prisma.requirement.findMany({ where: { ...mine, status: { notIn: ["online", "cancelled"] } }, select: { id: true, number: true, title: true, status: true, plannedEndAt: true, docPageId: true, project: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 8 }),
  ]);
  return {
    kpis: [
      { role: "business", label: "我提的进行中", value: active, note: "还没上线", href: "/requirements?proposer=me" },
      { role: "business", label: "本月已上线", value: online, note: "我提的需求", href: "/requirements?proposer=me" },
      { role: "business", label: "待我验收", value: accept, note: accept ? "测试完成，等你确认" : "没有待验收", danger: false, href: "/requirements?proposer=me" },
      { role: "business", label: "我提的 Bug", value: bugs, note: "还没解决", href: "/bugs" },
    ],
    block: {
      key: "business-progress",
      role: "business",
      title: "我的需求进度",
      count: active,
      more: { label: "全部", href: "/requirements?proposer=me" },
      empty: "你提的需求都上线了",
      rows: rows.map((r) => ({ id: r.id, title: `${reqCodeOf(r)} ${r.title}`, href: `/requirements/${r.id}`, tag: reqLabel(r.status), tone: "neutral", meta: `${r.project?.name || "未归属项目"}${r.plannedEndAt ? ` · 预计 ${ymd(r.plannedEndAt)}` : ""}${r.docPageId ? "" : " · 缺需求文档"}` })),
    },
    side: [await releasesCard(c, c.scope.get("business") ?? null)],
    buttons: c.readonly ? [] : [{ label: "提需求", href: "/requirements/new", primary: true }, { label: "提 Bug", href: "/bugs/new" }],
  };
}

async function productPart(c: Ctx): Promise<RolePart> {
  const rq = requirementWhere(c.access);
  const pf = projectFilter(c, "product");
  const triageWhere = { archivedAt: null, deletedAt: null, parentId: null, status: "req_in_progress", ...pf, AND: [rq] };
  const [triage, inReq, reviewing, online, rows, unassigned, products] = await Promise.all([
    prisma.requirement.count({ where: triageWhere }),
    prisma.requirement.count({ where: { archivedAt: null, deletedAt: null, status: { in: ["req_in_progress", "req_done", "req_design"] }, ...pf, AND: [rq] } }),
    prisma.review.count({ where: { status: "open", createdById: c.user.id } }),
    prisma.requirement.count({ where: { archivedAt: null, status: "online", actualEndAt: { gte: new Date(c.now.getFullYear(), c.now.getMonth(), 1) }, parentId: null, ...pf, AND: [rq] } }),
    prisma.requirement.findMany({ where: triageWhere, select: { id: true, number: true, title: true, createdAt: true, docPageId: true, priority: true, project: { select: { name: true } }, proposer: { select: { name: true } }, creator: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 6 }),
    prisma.requirement.count({ where: { projectId: null, archivedAt: null, deletedAt: null, AND: [rq] } }),
    prisma.product.findMany({ where: { ownerId: c.user.id, status: { not: "archived" } }, select: { id: true, name: true, _count: { select: { requirements: true, nodes: true } } }, take: 5 }),
  ]);
  const stale = rows.filter((r) => daysAgo(r.createdAt, c.now) > 7).length;
  const blockRows: WbRow[] = rows.map((r) => ({
    id: r.id,
    title: `${reqCodeOf(r)} ${r.title}`,
    href: `/requirements/${r.id}`,
    tag: r.project?.name || "",
    tone: daysAgo(r.createdAt, c.now) > 7 ? "danger" : "neutral",
    meta: `${r.proposer?.name || r.creator.name} 提出 · ${daysAgo(r.createdAt, c.now)} 天前 · ${r.priority.toUpperCase()}${r.docPageId ? "" : " · 缺需求文档"}`,
  }));
  if (unassigned) blockRows.unshift({ id: "unassigned", title: `${unassigned} 条以前的需求还没有项目`, href: "/system/unassigned", tag: "未归属", tone: "warning", meta: "需求池只在项目里，分到项目后才会出现在看板上" });
  return {
    kpis: [
      { role: "product", label: "新需求待梳理", value: triage, note: stale ? `${stale} 条超过 7 天` : "都在 7 天内", danger: stale > 0, href: "/requirements?stage=req" },
      { role: "product", label: "需求阶段中", value: inReq, note: "需求中 / 设计中 / 需求完成", href: "/requirements?stage=req" },
      { role: "product", label: "评审中", value: reviewing, note: "我发起的", href: "/requirements?stage=req" },
      { role: "product", label: "本月上线", value: online, note: "业务需求", href: "/requirements" },
    ],
    block: { key: "product-triage", role: "product", title: "待梳理的业务需求", count: triage + (unassigned ? 1 : 0), more: { label: "项目需求池", href: "/requirements?stage=req" }, empty: "没有待梳理的业务需求", rows: blockRows },
    side: [
      { key: "products", title: "我负责的产品", more: { label: "全部", href: "/products" }, rows: products.map((p) => ({ id: p.id, title: p.name, href: `/products/${p.id}`, meta: `需求 ${p._count.requirements} · 功能节点 ${p._count.nodes}` })) },
      await scheduleCard(c),
    ],
    buttons: c.readonly ? [] : [{ label: "新建需求", href: "/requirements/new", primary: true }, { label: "写 PRD", href: "/docs" }],
  };
}

async function designerPart(c: Ctx): Promise<RolePart> {
  const rq = requirementWhere(c.access);
  const pf = projectFilter(c, "designer");
  const mineOrScope = { OR: [{ assignees: { some: { userId: c.user.id, role: "design" } } }, pf] };
  const queueWhere = { archivedAt: null, deletedAt: null, status: { in: ["req_design", "req_done"] }, AND: [rq, mineOrScope] };
  const [queue, doing, tasksDue, delivered, rows] = await Promise.all([
    prisma.requirement.count({ where: queueWhere }),
    prisma.requirementTask.count({ where: { assigneeId: c.user.id, kind: "design", status: "doing" } }),
    prisma.requirementTask.count({ where: { assigneeId: c.user.id, kind: "design", status: { in: ["todo", "doing"] }, dueAt: { lt: c.today } } }),
    prisma.requirementArtifact.count({ where: { kind: { in: ["ui", "prototype"] }, createdById: c.user.id, createdAt: { gte: new Date(c.now.getFullYear(), c.now.getMonth(), 1) } } }),
    prisma.requirement.findMany({ where: queueWhere, select: { id: true, number: true, title: true, status: true, project: { select: { name: true } }, artifacts: { select: { kind: true } } }, orderBy: { updatedAt: "desc" }, take: 6 }),
  ]);
  return {
    kpis: [
      { role: "designer", label: "待设计", value: queue, note: "PRD 已确认", href: "/my/requirements?stage=req" },
      { role: "designer", label: "设计中任务", value: doing, note: "我的设计任务", href: "/my/requirements" },
      { role: "designer", label: "逾期设计任务", value: tasksDue, note: tasksDue ? "需要跟进" : "没有逾期", danger: tasksDue > 0, href: "/my/requirements" },
      { role: "designer", label: "本月交付", value: delivered, note: "原型 / UI 稿", href: "/my/requirements" },
    ],
    block: {
      key: "designer-queue",
      role: "designer",
      title: "设计队列",
      count: queue,
      empty: "没有等设计的需求",
      rows: rows.map((r) => {
        const proto = r.artifacts.some((a) => a.kind === "prototype");
        const ui = r.artifacts.some((a) => a.kind === "ui");
        return { id: r.id, title: `${reqCodeOf(r)} ${r.title}`, href: `/requirements/${r.id}#rq-artifacts`, tag: r.project?.name || "", tone: proto && ui ? "neutral" : "warning", meta: `${reqLabel(r.status)} · 原型${proto ? "已有" : "缺"} · UI ${ui ? "已有" : "缺"}` };
      }),
    },
    side: [await scheduleCard(c)],
    buttons: [],
  };
}

async function techPart(c: Ctx): Promise<RolePart> {
  const rq = requirementWhere(c.access);
  const pf = projectFilter(c, "tech_lead");
  const ids = c.scope.get("tech_lead") || [];
  const [toSplit, doing, late, highBugs, people, repos] = await Promise.all([
    prisma.requirement.count({ where: { status: "dev_todo", archivedAt: null, deletedAt: null, tasks: { none: {} }, ...pf, AND: [rq] } }),
    prisma.requirementTask.count({ where: { status: "doing", requirement: { ...pf, deletedAt: null } } }),
    prisma.requirementTask.count({ where: { status: { in: ["todo", "doing"] }, dueAt: { lt: c.today }, requirement: { ...pf, deletedAt: null } } }),
    prisma.bug.count({ where: { archivedAt: null, severity: { in: ["blocker", "critical"] }, status: { in: ["open", "in_progress", "reopened"] }, ...pf, AND: [bugWhere(c.access)] } }),
    prisma.requirementTask.groupBy({ by: ["assigneeId"], where: { status: { in: ["todo", "doing"] }, assigneeId: { not: null }, requirement: { ...pf, deletedAt: null } }, _count: { _all: true } }),
    prisma.gitRepo.findMany({ where: { projectId: { in: ids.length ? ids : ["__none__"] } }, select: { id: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: people.map((p) => p.assigneeId!).filter(Boolean) } }, select: { id: true, name: true } });
  const lateBy = await prisma.requirementTask.groupBy({ by: ["assigneeId"], where: { status: { in: ["todo", "doing"] }, dueAt: { lt: c.today }, assigneeId: { not: null }, requirement: { ...pf, deletedAt: null } }, _count: { _all: true } });
  const events = await prisma.gitEvent.findMany({ where: { repoId: { in: repos.map((r) => r.id) } }, select: { id: true, kind: true, summary: true, createdAt: true, error: true }, orderBy: { createdAt: "desc" }, take: 5 });
  return {
    kpis: [
      { role: "tech_lead", label: "待拆任务需求", value: toSplit, note: "待开发、还没任务", href: "/board" },
      { role: "tech_lead", label: "开发中任务", value: doing, note: "我的项目", href: "/board" },
      { role: "tech_lead", label: "逾期任务", value: late, note: late ? "需要跟进" : "没有逾期", danger: late > 0, href: "/board" },
      { role: "tech_lead", label: "高优 Bug", value: highBugs, note: "阻塞 / 严重未关闭", danger: highBugs > 0, href: "/bugs" },
    ],
    block: {
      key: "tech-team",
      role: "tech_lead",
      title: "团队任务",
      count: people.length,
      empty: "项目里还没有进行中的任务",
      rows: people
        .sort((a, b) => b._count._all - a._count._all)
        .slice(0, 6)
        .map((p) => {
          const n = lateBy.find((x) => x.assigneeId === p.assigneeId)?._count._all || 0;
          return { id: p.assigneeId!, title: users.find((u) => u.id === p.assigneeId)?.name || "—", href: "/board", tone: n ? "danger" : "neutral", tag: n ? `逾期 ${n}` : undefined, meta: `进行中 / 待开始 ${p._count._all} 个任务` };
        }),
    },
    side: [{ key: "git", title: "最近代码事件", rows: events.map((e) => ({ id: e.id, title: e.summary.slice(0, 60), href: "/system/git", meta: `${md(e.createdAt)}${e.error ? " · 失败" : ""}` })) }],
    buttons: [],
  };
}

async function devPart(c: Ctx): Promise<RolePart> {
  const { myTasks } = await import("../requirements/tasks");
  const mineBug = { archivedAt: null, OR: [{ assigneeId: c.user.id }, { frontendId: c.user.id }, { backendId: c.user.id }], status: { in: ["open", "in_progress", "reopened"] }, AND: [bugWhere(c.access)] };
  const [tasks, bugs] = await Promise.all([myTasks(c.user, { take: 50 }), prisma.bug.count({ where: mineBug })]);
  const todayEnd = c.todayEnd.toISOString();
  const today = c.today.toISOString();
  const dueToday = tasks.filter((t) => t.dueAt && t.dueAt <= todayEnd && t.dueAt >= today).length;
  const late = tasks.filter((t) => t.dueAt && t.dueAt < today).length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  return {
    kpis: [
      { role: "dev", label: "今天要做", value: dueToday, note: "今天到期的任务", href: "/my/requirements" },
      { role: "dev", label: "进行中", value: doing, note: `共 ${tasks.length} 个未完成任务`, href: "/my/requirements" },
      { role: "dev", label: "逾期任务", value: late, note: late ? "需要跟进" : "没有逾期", danger: late > 0, href: "/my/requirements" },
      { role: "dev", label: "我的 Bug", value: bugs, note: "还没解决", href: "/my/bugs" },
    ],
    block: {
      key: "dev-tasks",
      role: "dev",
      title: "我的任务",
      count: tasks.length,
      more: { label: "我的待办", href: "/my/requirements" },
      empty: "没有未完成的任务",
      rows: tasks.slice(0, 8).map((t) => ({ id: t.id, title: `${t.code} ${t.title}`, href: `/requirements/${t.requirement.id}#rq-tasks`, tag: t.status === "doing" ? "进行中" : "待开始", tone: t.dueAt && t.dueAt < today ? "danger" : "neutral", meta: `${t.requirement.code} ${t.requirement.title}${t.project ? ` · ${t.project.name}` : ""}${t.dueAt ? ` · 截止 ${t.dueAt.slice(0, 10)}` : ""}` })),
    },
    side: [],
    buttons: [],
  };
}

async function qaPart(c: Ctx): Promise<RolePart> {
  const rq = requirementWhere(c.access);
  const pf = projectFilter(c, "qa");
  const queueWhere = { archivedAt: null, deletedAt: null, status: { in: ["dev_done", "test_todo", "test_in_progress"] }, AND: [rq, { OR: [{ assignees: { some: { userId: c.user.id, role: "qa" } } }, pf] }] };
  const [queue, running, regress, weekRuns, rows] = await Promise.all([
    prisma.requirement.count({ where: queueWhere }),
    prisma.deliveryRun.count({ where: { createdById: c.user.id, kind: "round", status: { in: ["queued", "running", "manual", "done"] }, finalizedAt: null } }),
    prisma.bug.count({ where: { archivedAt: null, status: "resolved", creatorId: c.user.id, AND: [bugWhere(c.access)] } }),
    prisma.deliveryResult.groupBy({ by: ["status"], where: { run: { createdById: c.user.id, createdAt: { gte: c.weekStart } } }, _count: { _all: true } }),
    prisma.requirement.findMany({ where: queueWhere, select: { id: true, number: true, title: true, status: true, updatedAt: true, project: { select: { name: true } } }, orderBy: { updatedAt: "asc" }, take: 6 }),
  ]);
  const passed = weekRuns.find((r) => r.status === "passed")?._count._all || 0;
  const failed = weekRuns.find((r) => r.status === "failed")?._count._all || 0;
  const rate = passed + failed ? Math.round((passed / (passed + failed)) * 100) : 0;
  return {
    kpis: [
      { role: "qa", label: "待测需求", value: queue, note: "开发完成 / 待测 / 测试中", href: "/my/requirements?stage=test" },
      { role: "qa", label: "进行中的轮次", value: running, note: "我发起的", href: "/my/requirements?stage=test" },
      { role: "qa", label: "待回归 Bug", value: regress, note: "已解决等我确认", danger: false, href: "/bugs" },
      { role: "qa", label: "本周通过率", value: rate, note: passed + failed ? `${passed} 过 / ${failed} 不过` : "本周还没跑", danger: passed + failed > 0 && rate < 80, href: "/my/requirements?stage=test" },
    ],
    block: { key: "qa-queue", role: "qa", title: "测试队列", count: queue, more: { label: "全部", href: "/my/requirements?stage=test" }, empty: "没有等测试的需求", rows: rows.map((r) => ({ id: r.id, title: `${reqCodeOf(r)} ${r.title}`, href: `/requirements/${r.id}`, tag: reqLabel(r.status), tone: r.status === "dev_done" && daysAgo(r.updatedAt, c.now) > 5 ? "warning" : "neutral", meta: `${r.project?.name || ""} · ${daysAgo(r.updatedAt, c.now)} 天没动` })) },
    side: [await releasesCard(c, c.scope.get("qa") ?? null), await scheduleCard(c)],
    buttons: c.readonly ? [] : [{ label: "提 Bug", href: "/bugs/new", primary: true }],
  };
}

async function projectsPart(c: Ctx, role: "pm" | "manager"): Promise<RolePart> {
  const ids = c.scope.get(role);
  const projects = await prisma.project.findMany({ where: { status: "active", ...projectWhere(c.access), ...(ids ? { id: { in: ids.length ? ids : ["__none__"] } } : {}) }, select: { id: true, name: true, plannedEndAt: true }, orderBy: { createdAt: "asc" }, take: 50 });
  const pids = projects.map((p) => p.id);
  const scopeIds = { projectId: { in: pids.length ? pids : ["__none__"] } };
  const [prog, overdueRows, severe, stale] = await Promise.all([
    projectProgress(pids),
    prisma.requirement.findMany({ where: { archivedAt: null, deletedAt: null, ...scopeIds, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { lt: c.today }, AND: [requirementWhere(c.access)] }, select: { id: true, number: true, title: true, plannedEndAt: true, projectId: true, project: { select: { name: true } } }, orderBy: { plannedEndAt: "asc" }, take: 50 }),
    prisma.bug.count({ where: { archivedAt: null, ...scopeIds, status: { in: ["open", "in_progress", "reopened"] }, severity: { in: ["blocker", "critical"] }, AND: [bugWhere(c.access)] } }),
    prisma.requirement.findMany({ where: { archivedAt: null, deletedAt: null, ...scopeIds, status: "dev_done", updatedAt: { lt: subDays(c.now, 5) }, AND: [requirementWhere(c.access)] }, select: { id: true, number: true, title: true, updatedAt: true, project: { select: { name: true } } }, take: 10 }),
  ]);
  let all = 0;
  let done = 0;
  for (const g of prog.values()) {
    all += g.all;
    done += g.done;
  }
  const lateOf = (pid: string) => overdueRows.filter((r) => r.projectId === pid).length;
  if (role === "manager") {
    const online = await prisma.requirement.count({ where: { archivedAt: null, ...scopeIds, status: "online", actualEndAt: { gte: new Date(c.now.getFullYear(), c.now.getMonth(), 1) } } });
    return {
      kpis: [
        { role, label: "进行中项目", value: projects.length, note: `整体进度 ${all ? Math.round((done / all) * 100) : 0}%`, href: "/projects" },
        { role, label: "本月上线", value: online, note: `累计 ${done} / ${all}`, href: "/leadership" },
        { role, label: "逾期需求", value: overdueRows.length, note: overdueRows.length ? "需要跟进" : "没有逾期", danger: overdueRows.length > 0, href: "/leadership" },
        { role, label: "严重 Bug", value: severe, note: severe ? "阻塞 / 严重未关闭" : "没有严重 Bug", danger: severe > 0, href: "/bugs" },
      ],
      block: {
        key: "manager-health",
        role,
        title: "项目健康度",
        count: projects.length,
        more: { label: "进展总览", href: "/leadership" },
        empty: "暂无进行中的项目",
        rows: projects
          .map((p) => ({ p, late: lateOf(p.id), g: prog.get(p.id) || { done: 0, all: 0 } }))
          .sort((a, b) => b.late - a.late)
          .slice(0, 8)
          .map(({ p, late, g }) => ({ id: p.id, title: p.name, href: `/projects/${p.id}`, tag: late ? `逾期 ${late}` : undefined, tone: late ? "danger" : "neutral", meta: `需求 ${g.done}/${g.all} 已上线${p.plannedEndAt ? ` · 计划 ${ymd(p.plannedEndAt)}` : ""}`, progress: g.all ? Math.round((g.done / g.all) * 100) : 0 })),
      },
      side: [await releasesCard(c, null)],
      buttons: [{ label: "进展总览", href: "/leadership", primary: true }],
    };
  }
  const gate = await prisma.requirement.count({ where: { archivedAt: null, deletedAt: null, ...scopeIds, status: "dev_done", AND: [requirementWhere(c.access)] } });
  const risks: WbRow[] = [
    ...overdueRows.slice(0, 5).map((r) => ({ id: r.id, title: `${reqCodeOf(r)} ${r.title}`, href: `/requirements/${r.id}`, tag: "逾期", tone: "danger" as const, meta: `${r.project?.name || ""} · 计划 ${ymd(r.plannedEndAt)}` })),
    ...stale.slice(0, 4).map((r) => ({ id: r.id, title: `${reqCodeOf(r)} ${r.title}`, href: `/requirements/${r.id}`, tag: "待测过久", tone: "warning" as const, meta: `${r.project?.name || ""} · 开发完成 ${daysAgo(r.updatedAt, c.now)} 天，还没发起测试` })),
  ];
  return {
    kpis: [
      { role, label: "我的项目", value: projects.length, note: `整体进度 ${all ? Math.round((done / all) * 100) : 0}%`, href: "/projects" },
      { role, label: "逾期需求", value: overdueRows.length, note: overdueRows.length ? `最长逾期 ${daysAgo(overdueRows[0].plannedEndAt!, c.now)} 天` : "没有逾期", danger: overdueRows.length > 0, href: "/board" },
      { role, label: "开发完成待测", value: gate, note: stale.length ? `${stale.length} 条超过 5 天` : "都在 5 天内", href: "/board" },
      { role, label: "严重 Bug", value: severe, note: severe ? "阻塞 / 严重未关闭" : "没有严重 Bug", danger: severe > 0, href: "/bugs" },
    ],
    block: { key: "pm-risks", role, title: projects.length === 1 ? `${projects[0].name} · 风险清单` : "风险清单", count: risks.length, more: { label: "看板", href: "/board" }, empty: "没有逾期或卡住的需求", rows: risks },
    side: [await releasesCard(c, ids ?? null), await scheduleCard(c)],
    buttons: [],
  };
}

async function adminPart(c: Ctx): Promise<RolePart> {
  const [enterprises, users, cloudLinks, tableLinks] = await Promise.all([
    prisma.organization.count({ where: { type: "enterprise" } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.cloudDocLink.findMany({ where: { lastResult: { not: null } }, select: { id: true, lastResult: true, lastSyncAt: true }, orderBy: { lastSyncAt: "desc" }, take: 30 }),
    prisma.feishuTableLink.findMany({ select: { id: true, lastPull: true, lastPullAt: true }, orderBy: { lastPullAt: "desc" }, take: 30 }),
  ]);
  const failedOf = (s: string | null) => {
    if (!s) return false;
    try {
      const v = JSON.parse(s) as { error?: string; errors?: string[] };
      return Boolean(v.error || (v.errors && v.errors.length));
    } catch {
      return false;
    }
  };
  const fails: WbRow[] = [
    ...cloudLinks.filter((l) => failedOf(l.lastResult)).map((l) => ({ id: l.id, title: "云文档同步有错误", href: "/system/feishu-tables?tab=docs", tag: "云文档", tone: "danger" as const, meta: l.lastSyncAt ? md(l.lastSyncAt) : "" })),
    ...tableLinks.filter((l) => failedOf(l.lastPull)).map((l) => ({ id: l.id, title: "云表格拉取有错误", href: "/system/feishu-tables", tag: "云表格", tone: "danger" as const, meta: l.lastPullAt ? md(l.lastPullAt) : "" })),
  ];
  const month = new Date(c.now.getFullYear(), c.now.getMonth(), 1);
  const usage = await prisma.aiUsage.aggregate({ where: { createdAt: { gte: month } }, _sum: { inputTokens: true, outputTokens: true } });
  const tokens = (usage._sum.inputTokens || 0) + (usage._sum.outputTokens || 0);
  return {
    kpis: [
      { role: "admin", label: "企业", value: enterprises, note: "企业管理", href: "/system/enterprises" },
      { role: "admin", label: "活跃账号", value: users, note: "已启用", href: "/members" },
      { role: "admin", label: "失败的同步", value: fails.length, note: fails.length ? "云文档 / 云表格" : "最近都正常", danger: fails.length > 0, href: "/system/feishu-tables" },
      { role: "admin", label: "本月 AI 用量（千 token）", value: Math.round(tokens / 1000), note: "全部企业", href: "/settings/models" },
    ],
    block: { key: "admin-status", role: "admin", title: "平台状态", count: fails.length, empty: "同步任务最近一次都正常", rows: fails.slice(0, 6) },
    side: [],
    buttons: [{ label: "企业管理", href: "/system/enterprises", primary: true }],
  };
}

const ROLE_PART: Record<WbRole, (c: Ctx) => Promise<RolePart>> = {
  business: businessPart,
  product: productPart,
  designer: designerPart,
  tech_lead: techPart,
  dev: devPart,
  qa: qaPart,
  pm: (c) => projectsPart(c, "pm"),
  manager: (c) => projectsPart(c, "manager"),
  admin: adminPart,
};

export async function loadRoleWorkbench(user: SessionUser, now = new Date()): Promise<RoleWorkbench> {
  const c = await buildCtx(user, now);
  const roles = Array.from(c.scope.keys());
  const [inbox, parts, names] = await Promise.all([
    loadInbox(c),
    Promise.all(roles.map(async (r) => ({ role: r, part: await ROLE_PART[r](c) }))),
    prisma.project.findMany({ where: { id: { in: Array.from(new Set(Array.from(c.scope.values()).flatMap((x) => x || []))) } }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(names.map((p) => [p.id, p.name]));
  // 和「待我处理」重复的主区块行不再列：例如技术负责人的「待拆任务」已在待我处理里
  const inInbox = new Set(inbox.map((i) => i.href));
  const blocks = parts
    .map((p) => p.part.block)
    .filter((b): b is WbBlock => Boolean(b))
    .map((b) => (roles.length > 1 ? { ...b, rows: b.rows.filter((r) => !inInbox.has(r.href)) } : b));
  return {
    roles,
    roleProjects: roles.map((r) => ({ role: r, projects: (c.scope.get(r) || []).map((id) => nameOf.get(id) || "").filter(Boolean) })),
    kpis: pickKpis(parts.map((p) => ({ role: p.role, kpis: p.part.kpis }))),
    inbox,
    blocks,
    side: mergeSide(parts.flatMap((p) => p.part.side)).filter((s) => s.rows.length || s.key === "schedule"),
    buttons: pickButtons(parts.map((p) => ({ role: p.role, buttons: p.part.buttons }))),
  };
}

/** 只要「待我处理」（MCP get_my_inbox 用） */
export async function loadMyInbox(user: SessionUser, now = new Date()) {
  const c = await buildCtx(user, now);
  const items = await loadInbox(c);
  return { roles: Array.from(c.scope.keys()).map((r) => ({ key: r, label: WB_ROLE_LABEL[r] })), items };
}
