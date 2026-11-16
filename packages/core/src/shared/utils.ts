import { clsx, type ClassValue } from "clsx";
import { format, differenceInCalendarDays } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function fmtDate(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return format(date, "yyyy-MM-dd");
}

export function delayDays(plannedEndAt?: Date | null, actualEndAt?: Date | null) {
  if (!plannedEndAt) return null;
  const end = actualEndAt ?? new Date();
  return differenceInCalendarDays(end, plannedEndAt);
}

export function initials(name: string) {
  return name.slice(0, 1).toUpperCase();
}

/** 列表里的短日期：今年显示「11月06日」，其他年份显示完整日期 */
/** 「11月6日」：Nova 属性胶囊里的日期写法；跨年时带年份 */
export function fmtMonthDay(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.getFullYear() === new Date().getFullYear() ? format(date, "M月d日") : format(date, "yyyy年M月d日");
}

export function fmtShortDate(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.getFullYear() === new Date().getFullYear() ? format(date, "MM月dd日") : format(date, "yyyy-MM-dd");
}

/** 「10 分钟前 / 2 小时前 / 昨天 / 10月28日」 */
export function fmtAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 2 * 86400) return "昨天";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 更新时间（DESIGN-SPEC 10 文案规范）：「N 分钟前 / 今天 14:20 / 昨天 / 10月28日 / 2025年10月28日」（与 Figma 26 一致） */
export function fmtUpdated(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const now = new Date();
  const s = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (s >= 0 && s < 60) return "刚刚";
  if (s >= 0 && s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return "昨天";
  return date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
