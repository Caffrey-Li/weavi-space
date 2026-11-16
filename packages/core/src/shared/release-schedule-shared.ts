/**
 * 固定发版节奏 / 紧急发版的纯函数（服务端和客户端共用，不要引 prisma）。
 * 日期一律用「北京时间的日历日」字符串 YYYY-MM-DD 计算，存库时转成当天 00:00 UTC（与 DatePicker 一致）。
 */

export type ReleaseFrequency = "weekly" | "biweekly" | "monthly";

export type ReleaseScheduleConfig = {
  enabled: boolean;
  frequency: ReleaseFrequency;
  /** 每周 / 双周：周几（1=周一 … 7=周日） */
  weekday: number;
  /** 每月：几号（1–28），0 = 每月最后一天 */
  monthDay: number;
  /** 双周的起算日（第一次发版日期，YYYY-MM-DD） */
  anchorDate: string;
  /** 上线时间（HH:mm，仅展示） */
  releaseTime: string;
  /** 版本号模板：{yyyy} {yy} {MM} {M} {dd} {d} {n} */
  versionPattern: string;
  /** 标题模板，占位符同上 */
  titlePattern: string;
  /** 提前生成几个未来的发版计划（1–6） */
  horizon: number;
  /** 上线前几天自动冻结（0 = 不自动冻结） */
  freezeDays: number;
};

export const FREQUENCY_LABELS: Record<ReleaseFrequency, string> = { weekly: "每周", biweekly: "每两周", monthly: "每月" };
export const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 发版类型：normal 普通（手动新建）、scheduled 固定发版（按节奏自动生成）、hotfix 紧急发版 */
export const RELEASE_KINDS: Record<string, { label: string; tone: string }> = {
  normal: { label: "普通", tone: "neutral" },
  scheduled: { label: "固定发版", tone: "info" },
  hotfix: { label: "紧急发版", tone: "danger" },
};
export function releaseKind(kind?: string | null) {
  return kind === "scheduled" || kind === "hotfix" ? kind : "normal";
}

export const DEFAULT_SCHEDULE: ReleaseScheduleConfig = {
  enabled: true,
  frequency: "weekly",
  weekday: 4,
  monthDay: 0,
  anchorDate: "",
  releaseTime: "20:00",
  versionPattern: "{yyyy}.{MM}.{dd}",
  titlePattern: "{M}月{d}日固定发版",
  horizon: 2,
  freezeDays: 1,
};

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = 86400000;

export function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * 「只有日期」的字段（截止日期、计划上线等）入库用当天 12:00 UTC：
 * 东西 11 个时区内按本地时间或 UTC 显示都是同一天，不会差一天。
 */
export function dayNoon(s: string): Date | null {
  const d = parseYmd(s);
  return d ? new Date(d.getTime() + 12 * 3600_000) : null;
}
/** 北京时间的今天（YYYY-MM-DD） */
export function shanghaiToday(now = new Date()) {
  return ymd(new Date(now.getTime() + 8 * 3600_000));
}
export function addDays(s: string, n: number) {
  const d = parseYmd(s)!;
  return ymd(new Date(d.getTime() + n * DAY));
}
/** 1=周一 … 7=周日 */
function isoWeekday(d: Date) {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** 规范化入参（接口和表单共用），返回错误提示或规范后的配置 */
export function normalizeSchedule(raw: Partial<Record<keyof ReleaseScheduleConfig, unknown>>): ReleaseScheduleConfig | string {
  const frequency = String(raw.frequency || "weekly") as ReleaseFrequency;
  if (!FREQUENCY_LABELS[frequency]) return "发版周期不正确";
  const weekday = Number(raw.weekday ?? 4);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return "请选择周几发版";
  const monthDay = Number(raw.monthDay ?? 0);
  if (!Number.isInteger(monthDay) || monthDay < 0 || monthDay > 28) return "每月发版日只能是 1–28 号或月末";
  const anchorDate = String(raw.anchorDate || "");
  if (frequency === "biweekly" && !parseYmd(anchorDate)) return "每两周发版需要选择第一次发版日期";
  const releaseTime = String(raw.releaseTime || "").trim();
  if (releaseTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(releaseTime)) return "上线时间格式应为 HH:mm";
  const versionPattern = String(raw.versionPattern || "").trim();
  if (!versionPattern) return "请填写版本号规则";
  if (versionPattern.length > 60) return "版本号规则太长";
  if (!/\{(yyyy|yy|MM|M|dd|d|n)\}/.test(versionPattern)) return "版本号规则至少要包含一个日期或序号占位符，避免每期重名";
  const titlePattern = String(raw.titlePattern ?? "").trim().slice(0, 80);
  const horizon = Math.min(6, Math.max(1, Math.round(Number(raw.horizon ?? 2)) || 2));
  const freezeDays = Math.min(14, Math.max(0, Math.round(Number(raw.freezeDays ?? 0)) || 0));
  let anchor = parseYmd(anchorDate) ? anchorDate : "";
  // 双周起算日对齐到所选的周几
  if (frequency === "biweekly" && anchor) {
    const d = parseYmd(anchor)!;
    anchor = addDays(anchor, (weekday - isoWeekday(d) + 7) % 7);
  }
  return { enabled: raw.enabled !== false, frequency, weekday, monthDay, anchorDate: anchor, releaseTime, versionPattern, titlePattern, horizon, freezeDays };
}

/** 从 fromYmd（含）起的发版日期，最多 count 个 */
export function nextOccurrences(c: ReleaseScheduleConfig, fromYmd: string, count: number): string[] {
  const out: string[] = [];
  const from = parseYmd(fromYmd);
  if (!from || count <= 0) return out;
  if (c.frequency === "monthly") {
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth();
    for (let i = 0; out.length < count && i < 36; i++) {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const day = c.monthDay === 0 ? last : Math.min(c.monthDay, last);
      const d = ymd(new Date(Date.UTC(y, m, day)));
      if (d >= fromYmd) out.push(d);
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
    return out;
  }
  let d = new Date(from.getTime() + ((c.weekday - isoWeekday(from) + 7) % 7) * DAY);
  if (c.frequency === "biweekly") {
    const anchor = parseYmd(c.anchorDate) || d;
    const weeks = Math.round((d.getTime() - anchor.getTime()) / (7 * DAY));
    if (((weeks % 2) + 2) % 2 === 1) d = new Date(d.getTime() + 7 * DAY);
  }
  const step = c.frequency === "biweekly" ? 14 : 7;
  while (out.length < count) {
    out.push(ymd(d));
    d = new Date(d.getTime() + step * DAY);
  }
  return out;
}

/** 按模板生成版本号 / 标题；n = 该节奏下的第几期 */
export function fillPattern(pattern: string, dateYmd: string, n: number) {
  const [y, m, d] = dateYmd.split("-");
  return pattern
    .replace(/\{yyyy\}/g, y)
    .replace(/\{yy\}/g, y.slice(2))
    .replace(/\{MM\}/g, m)
    .replace(/\{M\}/g, String(Number(m)))
    .replace(/\{dd\}/g, d)
    .replace(/\{d\}/g, String(Number(d)))
    .replace(/\{n\}/g, String(n));
}

export function describeReleaseSchedule(c: Pick<ReleaseScheduleConfig, "frequency" | "weekday" | "monthDay" | "releaseTime">) {
  const when =
    c.frequency === "monthly"
      ? `每月${c.monthDay === 0 ? "最后一天" : `${c.monthDay} 号`}`
      : c.frequency === "weekly"
        ? `每${WEEKDAY_NAMES[c.weekday] || ""}`
        : `每两周的${WEEKDAY_NAMES[c.weekday] || ""}`;
  return `${when}${c.releaseTime ? ` ${c.releaseTime}` : ""}`;
}

/** 紧急发版的建议版本号：在最近一次已上线版本后加 -hotfix.N */
export function suggestHotfixVersion(base: string | null, existing: string[]) {
  const root = (base || "").replace(/-hotfix\.\d+$/i, "") || shanghaiToday().replace(/-/g, ".");
  const taken = new Set(existing.map((v) => v.toLowerCase()));
  for (let i = 1; i < 100; i++) {
    const v = `${root}-hotfix.${i}`;
    if (!taken.has(v.toLowerCase())) return v;
  }
  return `${root}-hotfix.${Date.now() % 1000}`;
}
