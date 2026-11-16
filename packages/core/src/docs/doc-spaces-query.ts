import { prisma } from "@pm-collab/db/prisma";
import { addCounts, countByType, emptyCounts, typedDocs, type TypeCounts } from "./doc-stats-query";
import { getAccess, productWhere, projectWhere } from "../access";

/**
 * 文档空间：产品 › 项目。每个项目一个空间；每个产品也有一个「产品资料」空间，放跨项目的产品说明、规范等。
 * 产品空间落在一条隐藏的 Project 记录上（status = "space"，productId 指向产品），文档、分组、权限沿用项目空间的全部逻辑，
 * 不改数据库结构。项目列表、看板等只取 status = "active" / 非 space 的项目，所以不会出现。
 */
export const SPACE_STATUS = "space";

/** 给产品补上「产品资料」空间（没有就建，产品改名时同步名称）；返回 productId → 空间 id */
export async function ensureProductSpaces(productIds?: string[]): Promise<Map<string, string>> {
  const products = await prisma.product.findMany({
    where: productIds ? { id: { in: productIds } } : {},
    select: { id: true, name: true, code: true, description: true, ownerId: true, enterpriseId: true },
  });
  const spaces = await prisma.project.findMany({
    where: { status: SPACE_STATUS, productId: { in: products.map((p) => p.id) } },
    select: { id: true, productId: true, name: true },
  });
  const out = new Map<string, string>();
  for (const p of products) {
    const s = spaces.find((x) => x.productId === p.id);
    if (s) {
      out.set(p.id, s.id);
      if (s.name !== p.name) await prisma.project.update({ where: { id: s.id }, data: { name: p.name, systemName: p.name } });
      continue;
    }
    let key = `PS-${p.code}`;
    for (let i = 2; await prisma.project.findUnique({ where: { key }, select: { id: true } }); i++) key = `PS-${p.code}-${i}`;
    const created = await prisma.project.create({
      data: {
        name: p.name,
        key,
        systemName: p.name,
        description: `「${p.name}」的产品资料：产品说明、规范、跨项目的设计与决策记录。`,
        status: SPACE_STATUS,
        productId: p.id,
        enterpriseId: p.enterpriseId,
        createdById: p.ownerId,
      },
      select: { id: true },
    });
    out.set(p.id, created.id);
  }
  return out;
}

export type SpaceTreeProject = { id: string; name: string; iconUrl: string | null; key?: string; description?: string | null; counts?: TypeCounts };
export type SpaceTree = {
  products: {
    id: string;
    name: string;
    code: string;
    description?: string | null;
    spaceId: string;
    projects: SpaceTreeProject[];
    /** 产品资料空间自身的文档数 */
    spaceCounts?: TypeCounts;
    /** 产品下全部文档（产品资料 + 各项目） */
    counts?: TypeCounts;
  }[];
  unassigned: SpaceTreeProject[];
};

/** 文档侧栏的空间树：当前用户数据范围内的产品（含产品资料空间）和项目空间 */
export async function loadSpaceTree(user: { id: string; globalRole: string }, opts: { counts?: boolean } = {}): Promise<SpaceTree> {
  const access = await getAccess(user);
  const [products, projects] = await Promise.all([
    prisma.product.findMany({
      where: { status: { not: "archived" }, AND: [productWhere(access)] },
      select: { id: true, name: true, code: true, description: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.project.findMany({
      where: { status: { notIn: ["archived", SPACE_STATUS] }, ...projectWhere(access) },
      select: { id: true, name: true, key: true, description: true, systemName: true, iconUrl: true, productId: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const spaceOf = await ensureProductSpaces(products.map((p) => p.id));
  // 各空间按文档类型计数（侧栏、所有空间页显示）
  const counts = opts.counts === false ? new Map<string, TypeCounts>() : countByType(await typedDocs([...Array.from(spaceOf.values()), ...projects.map((p) => p.id)]));
  const pick = (p: (typeof projects)[number]): SpaceTreeProject => ({
    id: p.id,
    name: p.name,
    key: p.key,
    description: p.description || p.systemName,
    iconUrl: p.iconUrl,
    counts: counts.get(p.id) || emptyCounts(),
  });
  return {
    products: products.map((p) => {
      const spaceId = spaceOf.get(p.id) || "";
      const list = projects.filter((x) => x.productId === p.id).map(pick);
      const spaceCounts = counts.get(spaceId) || emptyCounts();
      return { id: p.id, name: p.name, code: p.code, description: p.description, spaceId, projects: list, spaceCounts, counts: addCounts(spaceCounts, ...list.map((x) => x.counts)) };
    }),
    unassigned: projects.filter((x) => !x.productId || !products.some((p) => p.id === x.productId)).map(pick),
  };
}

export type SpaceRef = { spaceId: string; name: string; level: "product" | "project"; productName: string | null };
/** 当前用户可见的全部文档空间（产品资料空间 + 项目空间），带层级和所属产品名 */
export function flattenSpaces(tree: SpaceTree): SpaceRef[] {
  const out: SpaceRef[] = [];
  for (const p of tree.products) {
    if (p.spaceId) out.push({ spaceId: p.spaceId, name: p.name, level: "product", productName: p.name });
    for (const x of p.projects) out.push({ spaceId: x.id, name: x.name, level: "project", productName: p.name });
  }
  for (const x of tree.unassigned) out.push({ spaceId: x.id, name: x.name, level: "project", productName: null });
  return out;
}
