/**
 * 乐观锁：这些表每次更新都把 revision +1（写接口再用 src/lib/optimistic.ts 比较版本号）。
 * 只动了「不算内容」的字段时不加：updatedAt（评论等顺带刷新）、看板状态和排序（状态接口按 status 本身比较后写入，
 * 不占用版本号，免得详情页刚改完状态、再保存描述时撞上自己）、文档页面的浏览数和个人草稿。
 */
export const REVISION_IGNORE: Record<string, Set<string>> = {
  Requirement: new Set(["updatedAt", "status", "boardOrder", "actualEndAt"]),
  Bug: new Set(["updatedAt", "status", "boardOrder", "reopenCount"]),
  Release: new Set(["updatedAt"]),
  Project: new Set(["updatedAt"]),
  Product: new Set(["updatedAt"]),
  DocPage: new Set(["updatedAt", "viewCount", "draftTitle", "draftBody", "draftUpdatedAt"]),
};
export function bumpRevision(model: string, action: string, args: Record<string, unknown>) {
  const ignore = REVISION_IGNORE[model];
  if (!ignore) return;
  const key = action === "upsert" ? "update" : action === "update" || action === "updateMany" ? "data" : null;
  const data = key ? (args[key] as Record<string, unknown> | undefined) : undefined;
  if (!key || !data || typeof data !== "object" || "revision" in data) return;
  if (Object.keys(data).every((k) => ignore.has(k))) return;
  args[key] = { ...data, revision: { increment: 1 } };
}
