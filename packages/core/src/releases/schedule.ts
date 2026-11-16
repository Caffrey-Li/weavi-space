import { prisma } from "@pm-collab/db/prisma";
import {
  addDays,
  fillPattern,
  nextOccurrences,
  dayNoon,
  parseYmd,
  shanghaiToday,
  ymd,
  type ReleaseFrequency,
  type ReleaseScheduleConfig,
} from "../shared/release-schedule-shared";
export * from "../shared/release-schedule-shared";

/**
 * 固定发版节奏（每个项目一条 release_schedules）与紧急发版的表结构增量和自动生成逻辑。
 * 表结构在 prisma/migrations 的基线迁移里。
 *
 * 自动生成不依赖常驻定时器（Netlify 上没有）：打开发版列表 / 上线计划 / 项目概览时按需补齐，
 * 始终保持「未来 horizon 个」未取消的固定发版计划；用 updatedAt 乐观锁 + (projectId, version) 唯一约束防止并发重复生成。
 */
type ScheduleRow = NonNullable<Awaited<ReturnType<typeof prisma.releaseSchedule.findUnique>>>;

export function toConfig(s: ScheduleRow): ReleaseScheduleConfig {
  return {
    enabled: s.enabled,
    frequency: s.frequency as ReleaseFrequency,
    weekday: s.weekday,
    monthDay: s.monthDay,
    anchorDate: s.anchorDate || "",
    releaseTime: s.releaseTime || "",
    versionPattern: s.versionPattern,
    titlePattern: s.titlePattern || "",
    horizon: s.horizon,
    freezeDays: s.freezeDays,
  };
}

export async function getReleaseSchedule(projectId: string) {
  return prisma.releaseSchedule.findUnique({ where: { projectId } });
}

/** 未被动过的自动计划：规划中、没有关联需求和 Bug、计划日期在今天及以后 */
async function untouchedFuture(scheduleId: string) {
  const today = parseYmd(shanghaiToday())!;
  return prisma.release.findMany({
    where: { scheduleId, kind: "scheduled", status: "planning", plannedAt: { gte: today }, items: { none: {} }, bugs: { none: {} } },
    select: { id: true },
  });
}

/** 保存节奏：未被动过的未来自动计划会删掉，按新节奏重新生成（已加了需求或改过状态的保留） */
export async function saveReleaseSchedule(projectId: string, cfg: ReleaseScheduleConfig, userId: string) {
  const existing = await prisma.releaseSchedule.findUnique({ where: { projectId } });
  const data = {
    enabled: cfg.enabled,
    frequency: cfg.frequency,
    weekday: cfg.weekday,
    monthDay: cfg.monthDay,
    anchorDate: cfg.anchorDate || null,
    releaseTime: cfg.releaseTime || null,
    versionPattern: cfg.versionPattern,
    titlePattern: cfg.titlePattern || null,
    horizon: cfg.horizon,
    freezeDays: cfg.freezeDays,
    generatedUntil: null,
    updatedById: userId,
  };
  let removed = 0;
  if (existing) {
    const stale = await untouchedFuture(existing.id);
    if (stale.length) {
      await prisma.release.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      removed = stale.length;
    }
  }
  const schedule = existing
    ? await prisma.releaseSchedule.update({ where: { id: existing.id }, data })
    : await prisma.releaseSchedule.create({ data: { ...data, projectId, createdById: userId } });
  const created = cfg.enabled ? await ensureScheduledReleases(projectId) : 0;
  return { schedule, removed, created };
}

/** 停用节奏：删掉未被动过的未来自动计划，节奏配置保留 */
export async function disableReleaseSchedule(projectId: string, userId: string) {
  const s = await prisma.releaseSchedule.findUnique({ where: { projectId } });
  if (!s) return { removed: 0 };
  const stale = await untouchedFuture(s.id);
  if (stale.length) await prisma.release.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  await prisma.releaseSchedule.update({ where: { id: s.id }, data: { enabled: false, generatedUntil: null, updatedById: userId } });
  return { removed: stale.length };
}

const inflight = new Map<string, Promise<number>>();

/** 按节奏补齐未来的固定发版计划，并按「提前冻结天数」自动冻结；返回新生成的个数。失败只记日志，不影响页面 */
export function ensureScheduledReleases(projectId: string): Promise<number> {
  const running = inflight.get(projectId);
  if (running) return running;
  const p = generate(projectId)
    .catch((e) => {
      console.error("[固定发版] 自动生成失败", projectId, e);
      return 0;
    })
    .finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

/** 全部启用了节奏的项目（发版总列表用）；projectIds 为 null 表示不限 */
export async function ensureAllScheduledReleases(projectIds: string[] | null = null) {
  try {
    const list = await prisma.releaseSchedule.findMany({
      where: { enabled: true, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      select: { projectId: true },
    });
    for (const s of list) await ensureScheduledReleases(s.projectId);
  } catch (e) {
    console.error("[固定发版] 批量生成失败", e);
  }
}

async function generate(projectId: string): Promise<number> {
  const s = await prisma.releaseSchedule.findUnique({ where: { projectId } });
  if (!s || !s.enabled) return 0;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true, archivedAt: true, deletedAt: true } });
  if (!project || project.status !== "active" || project.archivedAt || project.deletedAt) return 0;
  const cfg = toConfig(s);
  const today = shanghaiToday();
  const todayDate = parseYmd(today)!;
  const actor = s.updatedById || s.createdById;

  // 1. 自动冻结：计划日期进入冻结窗口的规划中固定发版
  if (s.freezeDays > 0) {
    const due = await prisma.release.findMany({
      where: { scheduleId: s.id, kind: "scheduled", status: "planning", plannedAt: { lt: parseYmd(addDays(today, s.freezeDays + 1))!, gte: todayDate } },
      select: { id: true, version: true },
    });
    for (const r of due) {
      const ok = await prisma.release.updateMany({ where: { id: r.id, status: "planning" }, data: { status: "frozen" } });
      if (!ok.count) continue;
      await prisma.activityLog.create({
        data: {
          entityType: "release",
          entityId: r.id,
          action: "status_changed",
          actorId: null,
          fromValue: JSON.stringify({ status: "planning" }),
          toValue: JSON.stringify({ status: "frozen" }),
          message: `按固定发版节奏自动冻结（上线前 ${s.freezeDays} 天）`,
        },
      });
    }
  }

  // 2. 补齐未来的计划
  const upcoming = await prisma.release.findMany({
    where: { scheduleId: s.id, kind: "scheduled", plannedAt: { gte: todayDate } },
    select: { plannedAt: true, status: true },
  });
  const active = upcoming.filter((r) => r.status !== "cancelled").length;
  const need = s.horizon - active;
  if (need <= 0) return 0;
  const taken = new Set(upcoming.map((r) => (r.plannedAt ? ymd(r.plannedAt) : "")));
  const after = s.generatedUntil && s.generatedUntil >= today ? addDays(s.generatedUntil, 1) : today;
  const dates = nextOccurrences(cfg, after, need + taken.size + 2)
    .filter((d) => !taken.has(d))
    .slice(0, need);
  if (!dates.length) return 0;

  // 乐观锁：先占住这次生成，别的请求同时进来会更新失败直接返回
  const claim = await prisma.releaseSchedule.updateMany({
    where: { id: s.id, updatedAt: s.updatedAt },
    data: { generatedUntil: dates[dates.length - 1], seq: s.seq + dates.length },
  });
  if (!claim.count) return 0;

  let created = 0;
  let seq = s.seq;
  for (const d of dates) {
    seq++;
    const base = fillPattern(cfg.versionPattern, d, seq).replace(/^v/i, "").trim();
    let version = base;
    for (let i = 2; i < 20; i++) {
      const dup = await prisma.release.findUnique({ where: { projectId_version: { projectId, version } }, select: { id: true } });
      if (!dup) break;
      version = `${base}-${i}`;
    }
    try {
      const rel = await prisma.release.create({
        data: {
          projectId,
          version,
          title: cfg.titlePattern ? fillPattern(cfg.titlePattern, d, seq) : null,
          description: `按固定发版节奏自动生成${cfg.releaseTime ? `，计划 ${cfg.releaseTime} 上线` : ""}。`,
          plannedAt: dayNoon(d),
          kind: "scheduled",
          scheduleId: s.id,
          createdById: actor,
        },
      });
      await prisma.activityLog.create({
        data: { entityType: "release", entityId: rel.id, action: "created", actorId: null, message: `按固定发版节奏自动生成 v${version}` },
      });
      created++;
    } catch (e) {
      // 并发时唯一约束冲突：别处已经生成过，跳过即可
      if (!/Unique constraint/i.test(String(e))) throw e;
    }
  }
  return created;
}

/** 紧急发版可选的 Bug：本项目未关闭、未归档的，线上环境和严重级别高的排前面 */
export async function hotfixBugCandidates(projectId: string) {
  const rows = await prisma.bug.findMany({
    where: { projectId, archivedAt: null, deletedAt: null, status: { in: ["open", "in_progress", "reopened", "resolved"] } },
    select: { id: true, title: true, status: true, severity: true, environment: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const sev: Record<string, number> = { blocker: 0, critical: 1, major: 2, minor: 3, trivial: 4 };
  return rows.sort(
    (a, b) =>
      Number(b.environment === "production") - Number(a.environment === "production") ||
      (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}
