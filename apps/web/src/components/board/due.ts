import { differenceInCalendarDays, format } from "date-fns";

/** 计划完成日 → 卡片上的到期提示；已完成的不再提示逾期 */
export function dueInfo(plannedEndAt: string | Date | null | undefined, done: boolean) {
  if (!plannedEndAt) return null;
  const d = typeof plannedEndAt === "string" ? new Date(plannedEndAt) : plannedEndAt;
  if (Number.isNaN(d.getTime())) return null;
  const diff = differenceInCalendarDays(new Date(), d);
  if (!done && diff > 0) return { overdue: true, label: `逾期 ${diff} 天` };
  if (!done && diff === 0) return { overdue: false, label: "今天到期" };
  return { overdue: false, label: format(d, "MM-dd") };
}
