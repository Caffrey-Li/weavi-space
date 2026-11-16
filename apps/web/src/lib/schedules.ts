import { bugWhere, getAccess, requirementWhere } from "./access";
import { prisma } from "./prisma";
import { buildCard, deliver, siteUrl, type Channel } from "./feishu-bot";
import { loadReleasePlans } from "./release-plans";
import { BUG_STATUS, reqStatusLabel } from "./constants";
export { SCHEDULE_KINDS, WEEKDAY_LABELS, describeSchedule } from "./schedules-shared";

/**
 * 个人定时任务：每分钟检查一次（instrumentation-node 启动），到点（服务器本机时间）发到本人的机器人。
 * 同一任务一天只发一次；用 lastRunAt 做乐观锁，多个进程同时检查也不会重复发送。
 * 服务停机错过的时间点，在 60 分钟内恢复会补发，超过则当天跳过。
 */
/** 按服务器本机时间（不写死时区） */
function localNow(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const wd = d.getDay() === 0 ? 7 : d.getDay();
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, weekday: wd, minutes: d.getHours() * 60 + d.getMinutes() };
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

export async function buildScheduleCard(s: { userId: string; name: string; kind: string; message: string | null }) {
  if (s.kind === "text") return buildCard({ title: s.name, lines: [s.message || "（没有填写内容）"], tone: "blue" });
  if (s.kind === "plans") {
    const projects = await prisma.projectMember.findMany({ where: { userId: s.userId, project: { status: "active" } }, select: { project: { select: { id: true, name: true } } } });
    const lines: string[] = [];
    for (const { project } of projects) {
      const plans = (await loadReleasePlans(project.id)).filter((p) => p.status !== "released");
      for (const p of plans.slice(0, 5)) {
        lines.push(`**${project.name}** · v${p.version}${p.title ? ` ${p.title}` : ""}：完成 ${p.done}/${p.total}（${p.pct}%）${p.plannedAt ? ` · 计划 ${md(new Date(p.plannedAt))}` : ""}`);
      }
    }
    return buildCard({ title: s.name, lines: lines.length ? lines : ["你所在的项目暂时没有未上线的计划"], url: siteUrl("/projects"), tone: "green" });
  }
  // digest
  const now = Date.now();
  const owner = await prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, globalRole: true } });
  const access = await getAccess(owner ?? { id: s.userId, globalRole: "guest" });
  const [reqs, bugs] = await Promise.all([
    prisma.requirement.findMany({
      where: { archivedAt: null, status: { notIn: ["online", "cancelled"] }, assignees: { some: { userId: s.userId } }, AND: [requirementWhere(access)] },
      select: { id: true, title: true, status: true, plannedEndAt: true, project: { select: { name: true } } },
      orderBy: [{ plannedEndAt: "asc" }, { updatedAt: "desc" }],
      take: 30,
    }),
    prisma.bug.findMany({
      where: { archivedAt: null, OR: [{ assigneeId: s.userId }, { frontendId: s.userId }, { backendId: s.userId }], AND: [bugWhere(access)], status: { in: ["open", "in_progress", "reopened"] } },
      select: { id: true, title: true, status: true, severity: true, dueAt: true },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 20,
    }),
  ]);
  const due = (d: Date | null) => {
    if (!d) return "";
    const days = Math.ceil((d.getTime() - now) / 86400000);
    return days < 0 ? ` · <font color='red'>已逾期 ${-days} 天</font>` : days <= 3 ? ` · ${days === 0 ? "今天到期" : `${days} 天后到期`}` : ` · ${md(d)}`;
  };
  const sortDue = <T extends { d: Date | null }>(a: T, b: T) => (a.d?.getTime() ?? Infinity) - (b.d?.getTime() ?? Infinity);
  const reqLines = reqs
    .map((r) => ({ d: r.plannedEndAt, t: `[${r.title}](${siteUrl(`/requirements/${r.id}`)}) · ${reqStatusLabel(r.status)}${due(r.plannedEndAt)}` }))
    .sort(sortDue)
    .slice(0, 12)
    .map((x) => `• ${x.t}`);
  const bugLabel = (k: string) => BUG_STATUS.find((b) => b.key === k)?.label || k;
  const bugLines = bugs
    .map((b) => ({ d: b.dueAt, t: `[${b.title}](${siteUrl(`/bugs?bug=${b.id}`)}) · ${bugLabel(b.status)}${due(b.dueAt)}` }))
    .sort(sortDue)
    .slice(0, 8)
    .map((x) => `• ${x.t}`);
  const lines = [`需求 ${reqs.length} 条 · Bug ${bugs.length} 个待处理`];
  if (reqLines.length) lines.push("", "**需求**", ...reqLines);
  if (bugLines.length) lines.push("", "**Bug**", ...bugLines);
  if (!reqs.length && !bugs.length) lines.push("今天没有待办，清爽 ✨");
  return buildCard({ title: s.name, lines, url: siteUrl("/my/requirements"), button: "查看我的待办", tone: "blue" });
}

export async function runSchedule(id: string) {
  const s = await prisma.userSchedule.findUnique({ where: { id } });
  if (!s) return { ok: false, error: "任务不存在", hasSuccess: false, hasChannel: false };
  const card = await buildScheduleCard(s);
  const results = await deliver(s.userId, card, s.channel as Channel);
  const hasChannel = results.length > 0;
  const hasSuccess = results.some((r) => r.ok);
  const ok = hasChannel && results.every((r) => r.ok);
  const status = !results.length ? "没有可用的发送渠道：请先在「发送渠道」开启群机器人或私信" : ok ? "已发送" : results.filter((r) => !r.ok).map((r) => r.error).join("；");
  await prisma.userSchedule.update({ where: { id }, data: { lastStatus: status.slice(0, 300) } });
  return { ok, error: ok ? undefined : status, hasSuccess, hasChannel };
}

export async function runDueSchedules(now = new Date()) {
  const sh = localNow(now);
  const list = await prisma.userSchedule.findMany({ where: { enabled: true } });
  for (const s of list) {
    const days = s.weekdays.split(",").map(Number).filter((n) => n >= 1 && n <= 7);
    if (days.length && !days.includes(sh.weekday)) continue;
    const m = s.time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const at = Number(m[1]) * 60 + Number(m[2]);
    if (sh.minutes < at || sh.minutes - at > 60) continue;
    if (s.lastRunAt && localNow(s.lastRunAt).day === sh.day) continue;
    // 乐观锁：只有抢到这次更新的进程负责发送
    const claimed = await prisma.userSchedule.updateMany({ where: { id: s.id, lastRunAt: s.lastRunAt }, data: { lastRunAt: now } });
    if (!claimed.count) continue;
    try {
      await runSchedule(s.id);
    } catch (e) {
      await prisma.userSchedule.update({ where: { id: s.id }, data: { lastStatus: `发送失败：${e instanceof Error ? e.message : "未知错误"}`.slice(0, 300) } });
    }
  }
}


export async function enqueueDueSchedules(now = new Date()) {
  const sh = localNow(now);
  const list = await prisma.userSchedule.findMany({ where: { enabled: true } });
  for (const s of list) {
    const days = s.weekdays.split(",").map(Number).filter((n) => n >= 1 && n <= 7);
    if (days.length && !days.includes(sh.weekday)) continue;
    const m = s.time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const at = Number(m[1]) * 60 + Number(m[2]);
    if (sh.minutes < at || sh.minutes - at > 60) continue;
    if (s.lastRunAt && localNow(s.lastRunAt).day === sh.day) continue;
    const { enqueueReminder } = await import("./scheduler-queue");
    await enqueueReminder(s.id, now);
  }
}

/** 队列重试时允许同一任务继续自己的发送，不重新抢占别的执行。 */
export async function runQueuedSchedule(id: string, scheduledAt: string) {
  const now = new Date(scheduledAt);
  const s = await prisma.userSchedule.findUnique({ where: { id } });
  if (!s || !s.enabled) return;
  if (s.lastRunAt?.getTime() !== now.getTime()) {
    if (s.lastRunAt && localNow(s.lastRunAt).day === localNow(now).day) return;
    const claimed = await prisma.userSchedule.updateMany({ where: { id, lastRunAt: s.lastRunAt }, data: { lastRunAt: now } });
    if (!claimed.count) return;
  }
  let result: Awaited<ReturnType<typeof runSchedule>>;
  try {
    result = await runSchedule(id);
  } catch (e) {
    await prisma.userSchedule.update({ where: { id }, data: { lastStatus: `发送失败：${e instanceof Error ? e.message : "未知错误"}`.slice(0, 300) } });
    throw e;
  }
  if (!result.hasSuccess && result.hasChannel) throw new Error(result.error || "发送失败");
}

/** 常驻进程启动队列；Netlify 无常驻进程，不启动。 */
export function startScheduler() {
  if (process.env.NETLIFY || process.env.DISABLE_SCHEDULER === "1") return;
  void import("./scheduler-queue")
    .then((m) => { void m.startJobScheduler().catch(() => undefined); })
    .catch((e) => console.error("[定时任务] 队列模块加载失败", e));
}
