import { REQ_STATUS, REQ_STATUS_OPTIONS } from "./constants";

/**
 * 需求阶段配置（Figma 52，前后端共用，不能引 prisma）：可以停用部分阶段（如「需求完成」），
 * 看板列、状态抽屉、状态菜单、需求池筛选都只显示启用的阶段。
 * 「需求中」（新需求的起点）、「已上线」（唯一计完成）、「已取消」必须保留。
 */
export const LOCKED_REQ_STATUSES = ["req_in_progress", "online", "cancelled"] as const;
export const REQ_STAGES_SETTING_KEY = "reqHiddenStatuses";

const ALL = REQ_STATUS.map((s) => s.key as string);

/** 存储值 → 停用的阶段（去掉不存在的和必须保留的） */
export function parseHiddenStatuses(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.map(String))).filter((s) => ALL.includes(s) && !(LOCKED_REQ_STATUSES as readonly string[]).includes(s));
}

export function visibleStatusOptions(hidden: readonly string[]) {
  return REQ_STATUS_OPTIONS.filter((s) => !hidden.includes(s.key));
}

/** 停用阶段的需求（例如外部同步写进来的）落到哪个阶段：按顺序往后找第一个启用的，找不到就往前 */
export function remapHiddenStatus(status: string, hidden: readonly string[]): string {
  if (!hidden.includes(status)) return status;
  const i = ALL.indexOf(status);
  for (let j = i + 1; j < ALL.length; j++) if (!hidden.includes(ALL[j]) && ALL[j] !== "cancelled") return ALL[j];
  for (let j = i - 1; j >= 0; j--) if (!hidden.includes(ALL[j])) return ALL[j];
  return "req_in_progress";
}
