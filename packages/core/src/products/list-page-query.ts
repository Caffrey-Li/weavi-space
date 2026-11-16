import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, productWhere } from "../access";
import { can } from "../permissions";
import { joinedProductWhere } from "../shared/products";

export async function canManageProducts(session: SessionUser | null) {
  return session ? can(session, "products.manage") : false;
}

export async function loadProductList(session: SessionUser | null, { canManage, view, q, status, owner }: { canManage: boolean; view: string; q: string; status: string; owner: string }) {
  const scope = session ? productWhere(await getAccess(session)) : { id: "__none__" };
  const products = await prisma.product.findMany({
    where: {
      AND: [scope, ...(view === "joined" && session ? [joinedProductWhere(session.id)] : [])],
      ...(view === "archived" ? { status: "archived" } : status ? { status } : { status: { not: "archived" } }),
      ...(view === "mine" && session ? { ownerId: session.id } : {}),
      ...(owner ? { ownerId: owner } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      owner: { select: { name: true, avatarUrl: true } },
      nodes: { select: { type: true } },
      projects: { where: { status: { not: "space" }, deletedAt: null }, select: { id: true, name: true, iconUrl: true } },
      _count: { select: { requirements: { where: { archivedAt: null } } } },
    },
  });
  const [allProducts, owners] = await Promise.all([
    canManage ? prisma.product.findMany({ where: { AND: [scope] }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { ownedProducts: { some: { AND: [scope] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { products, allProducts, owners };
}
