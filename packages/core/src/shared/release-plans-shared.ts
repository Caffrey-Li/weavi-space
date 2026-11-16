/** 上线计划：前后端共用的类型和展示函数（不依赖数据库） */
export type PlanReq = { id: string; code: string; title: string; status: string; statusLabel: string; doneAt: string | null };
export type PlanRow = {
  id: string;
  version: string;
  title: string;
  status: string;
  plannedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  done: number;
  total: number;
  pct: number;
  doneReqs: PlanReq[];
  openReqs: PlanReq[];
};

/** 计划的展示状态：已上线 / 进行中（已冻结、发布中，或已有需求完成）/ 规划中；超过计划日期未上线标「已延期」 */
export function planTone(p: Pick<PlanRow, "status" | "plannedAt" | "done">): { label: string; tone: "success" | "info" | "neutral" | "danger" } {
  if (p.status === "released") return { label: "已上线", tone: "success" };
  if (p.plannedAt && new Date(p.plannedAt).getTime() < Date.now() - 86400000) return { label: "已延期", tone: "danger" };
  if (p.status === "frozen" || p.status === "releasing" || p.done > 0) return { label: "进行中", tone: "info" };
  return { label: "规划中", tone: "neutral" };
}

const md = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 「计划 11月14日 · 还有 13 天」「计划 10月28日 · 实际 10月27日上线」 */
export function planDates(p: Pick<PlanRow, "status" | "plannedAt" | "releasedAt">): string {
  const parts: string[] = [];
  parts.push(p.plannedAt ? `计划 ${md(p.plannedAt)}` : "未定上线日期");
  if (p.status === "released" && p.releasedAt) parts.push(`实际 ${md(p.releasedAt)}上线`);
  else if (p.plannedAt) {
    const days = Math.ceil((new Date(p.plannedAt).getTime() - Date.now()) / 86400000);
    parts.push(days >= 0 ? (days === 0 ? "今天上线" : `还有 ${days} 天`) : `已超期 ${-days} 天`);
  }
  return parts.join(" · ");
}

export function shortDay(iso: string | null) {
  return iso ? md(iso) : "";
}
