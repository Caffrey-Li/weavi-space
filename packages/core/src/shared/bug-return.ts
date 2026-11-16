/** Bug「退回」判断（纯函数，客户端、迁移脚本也引用，不要引 prisma） */
const DONE = ["resolved", "closed"];
const BACK = ["open", "in_progress", "reopened"];
export function isBugReturn(from: string, to: string) {
  return DONE.includes(from) && BACK.includes(to);
}

/** 按状态变更动态（fromValue / toValue 里的 status）统计每个 Bug 的退回次数，回填用 */
export function countBugReturns(logs: { entityId: string; fromValue: string | null; toValue: string | null }[]) {
  const read = (v: string | null) => {
    try {
      return String((JSON.parse(v || "{}") as { status?: string }).status || "");
    } catch {
      return "";
    }
  };
  const out = new Map<string, number>();
  for (const l of logs) if (isBugReturn(read(l.fromValue), read(l.toValue))) out.set(l.entityId, (out.get(l.entityId) || 0) + 1);
  return out;
}
