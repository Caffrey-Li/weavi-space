/** 归档 / 回收站：客户端也要用的常量（不能引入 prisma） */
export type Kind = "product" | "project" | "requirement" | "bug" | "doc";
export const KIND_LABEL: Record<Kind, string> = { product: "产品", project: "项目", requirement: "需求", bug: "Bug", doc: "文档" };
export type LifecycleAction = "archive" | "unarchive" | "delete" | "restore" | "purge";

/** 调用 /api/lifecycle；成功返回 null，失败返回错误文字 */
export async function lifecycle(kind: Kind, id: string, action: LifecycleAction): Promise<string | null> {
  const res = await fetch("/api/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, action }) });
  if (res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { error?: string };
  return d.error || "操作失败";
}
