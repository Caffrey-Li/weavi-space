import { prisma } from "@pm-collab/db/prisma";

/**
 * 文档按类型统计 / 列表：类型 = 根页面所在分组的默认 key（product 产品文档 / dev 开发文档 / project 业务文档），
 * 自定义分组归为 other；子页面跟随根页面；没分组或分组已删的根页面算业务文档（与侧栏一致）。
 */
export type DocType = "product" | "dev" | "project" | "other";
export const DOC_TYPES: { key: DocType; label: string; short: string }[] = [
  { key: "product", label: "产品文档", short: "产品" },
  { key: "dev", label: "开发文档", short: "开发" },
  { key: "project", label: "业务文档", short: "业务" },
  { key: "other", label: "其他分组", short: "其他" },
];
export type TypeCounts = Record<DocType, number> & { total: number };
export const emptyCounts = (): TypeCounts => ({ product: 0, dev: 0, project: 0, other: 0, total: 0 });

export type DocRow = {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  draftTitle: string | null;
  version: number;
  updatedAt: Date;
  type: DocType;
  groupName: string;
  updatedBy: { name: string; avatarUrl: string | null } | null;
};

/** 读取空间里的全部页面并标上类型（只取需要的字段） */
export async function typedDocs(spaceIds: string[]): Promise<DocRow[]> {
  if (!spaceIds.length) return [];
  const [pages, groups] = await Promise.all([
    prisma.docPage.findMany({
      where: { projectId: { in: spaceIds } },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        groupId: true,
        title: true,
        draftTitle: true,
        version: true,
        updatedAt: true,
        updatedBy: { select: { name: true, avatarUrl: true } },
        creator: { select: { name: true, avatarUrl: true } },
      },
    }),
    prisma.docGroup.findMany({ where: { projectId: { in: spaceIds } }, select: { id: true, key: true, name: true } }),
  ]);
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const rootGroup = (p: (typeof pages)[number]) => {
    let cur = p;
    for (let i = 0; i < 50 && cur.parentId; i++) {
      const up = byId.get(cur.parentId);
      if (!up) break;
      cur = up;
    }
    return cur.groupId ? groupOf.get(cur.groupId) : undefined;
  };
  return pages.map((p) => {
    const g = rootGroup(p);
    const key = g?.key;
    const type: DocType = key === "product" || key === "dev" || key === "project" ? key : g ? "other" : "project";
    const name = g ? (g.key === "project" && g.name === "项目文档" ? "业务文档" : g.name) : "业务文档";
    return {
      id: p.id,
      spaceId: p.projectId,
      parentId: p.parentId,
      title: p.title,
      draftTitle: p.draftTitle,
      version: p.version,
      updatedAt: p.updatedAt,
      type,
      groupName: name,
      updatedBy: p.updatedBy || p.creator,
    };
  });
}

export function countByType(rows: DocRow[]): Map<string, TypeCounts> {
  const out = new Map<string, TypeCounts>();
  for (const r of rows) {
    let c = out.get(r.spaceId);
    if (!c) out.set(r.spaceId, (c = emptyCounts()));
    c[r.type]++;
    c.total++;
  }
  return out;
}

export function addCounts(...list: (TypeCounts | undefined)[]): TypeCounts {
  const out = emptyCounts();
  for (const c of list) if (c) for (const k of [...DOC_TYPES.map((t) => t.key), "total"] as const) out[k] += c[k];
  return out;
}
