/** 产品功能结构的纯函数与类型（客户端、服务端都可引用，不要在这里引入 prisma） */

export const PRODUCT_NODE_TYPES = [
  { key: "menu", label: "菜单" },
  { key: "module", label: "功能模块" },
  { key: "feature", label: "功能点" },
] as const;
export type ProductNodeType = (typeof PRODUCT_NODE_TYPES)[number]["key"];

export function productNodeTypeLabel(type: string) {
  return PRODUCT_NODE_TYPES.find((t) => t.key === type)?.label ?? type;
}

/** 允许的父子关系：菜单下可放菜单 / 模块；模块下可放功能点；功能点是叶子 */
export function canNest(parentType: string | null, childType: string) {
  if (!parentType) return childType === "menu" || childType === "module";
  if (parentType === "menu") return childType === "menu" || childType === "module";
  if (parentType === "module") return childType === "feature";
  return false;
}

export type ProductNodeRow = {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  code?: string | null;
  ownerId?: string | null;
  description: string | null;
  sortOrder: number;
};
export type ProductTreeNode<T extends ProductNodeRow = ProductNodeRow & { reqCount: number }> = T & { children: ProductTreeNode<T>[]; path: string[] };

/** 平铺节点 → 树（同级按 sortOrder），并给每个节点算出完整路径 */
export function buildProductTree<T extends ProductNodeRow>(rows: T[]): ProductTreeNode<T & { reqCount: number }>[] {
  const byParent = new Map<string | null, T[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) || [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  const walk = (parentId: string | null, path: string[]): ProductTreeNode<T & { reqCount: number }>[] =>
    (byParent.get(parentId) || [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"))
      .map((r) => {
        const p = [...path, r.name];
        const reqCount = (r as { reqCount?: number }).reqCount ?? 0;
        return { ...r, reqCount, path: p, children: walk(r.id, p) };
      });
  return walk(null, []);
}

export const PRODUCT_STATUS = [
  { key: "planning", label: "规划中", tone: "is-info" },
  { key: "maintaining", label: "维护中", tone: "is-success" },
  { key: "archived", label: "已归档", tone: "" },
] as const;

export function productStatus(key: string) {
  return PRODUCT_STATUS.find((s) => s.key === key) ?? PRODUCT_STATUS[1];
}

/** 产品图标的代表色：按编码取色，归档产品用中性灰（Figma 26 产品图标） */
export function productTone(code: string, status?: string) {
  if (status === "archived") return "var(--nv-gray-500)";
  const TONES = ["var(--nv-blue-600)", "var(--nv-teal-600)", "var(--nv-purple-600)", "var(--nv-amber-600)", "var(--nv-pink-600)", "var(--nv-green-600)", "var(--nv-indigo-600)"];
  let h = 0;
  for (const ch of code || "?") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** 「我参与的」产品：我负责的、我负责某个功能模块的、或我是其关联项目成员的（不含产品资料空间） */
export function joinedProductWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { nodes: { some: { ownerId: userId } } },
      { projects: { some: { status: { not: "space" }, members: { some: { userId } } } } },
    ],
  };
}
