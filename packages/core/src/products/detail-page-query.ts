import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, productWhere } from "../access";
import { can } from "../permissions";

export async function findProductForPage(id: string) {
  const product = await prisma.product.findUnique({
    where: { id: id },
    include: {
      nodes: { select: { id: true, parentId: true, type: true, name: true, code: true, ownerId: true, description: true, sortOrder: true } },
    },
  });
  return product;
}

export async function canViewProductPage(session: SessionUser, id: string) {
  return prisma.product.count({ where: { id, AND: [productWhere(await getAccess(session))] } });
}
export async function canManageProductPage(session: SessionUser) {
  return can(session, "products.manage");
}
export async function loadProductIntro(product: { id: string }) {
    const intro = await prisma.productIntro.findUnique({ where: { productId: product.id } });
    const editor = intro?.updatedById ? await prisma.user.findUnique({ where: { id: intro.updatedById }, select: { name: true } }) : null;
  return { intro, editor };
}
export async function loadProductArchitectures(product: { id: string }) {
    const items = await prisma.productArchitecture.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, name: true, imageId: true, updatedAt: true },
    });
  return items;
}
export async function loadProductTree(product: { id: string }) {
  const [counts, reqs, owners] = await Promise.all([
    prisma.requirement.groupBy({ by: ["productNodeId"], where: { productId: product.id, archivedAt: null }, _count: true }),
    prisma.requirement.findMany({
      where: { productId: product.id, archivedAt: null, productNodeId: { not: null } },
      select: { id: true, number: true, title: true, status: true, productNodeId: true, project: { select: { key: true } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, avatarUrl: true }, orderBy: { name: "asc" } }),
  ]);
  return { counts, reqs, owners };
}
