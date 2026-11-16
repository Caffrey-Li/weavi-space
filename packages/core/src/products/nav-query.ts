import { prisma } from "@pm-collab/db/prisma";
import { getAccess, productWhere } from "../access";
import { joinedProductWhere } from "../shared/products";

/** 「产品」侧栏数据（app layout 首屏和 /api/products/nav 共用，保证两边一致） */
export async function loadProductNav(user: { id: string; globalRole: string }) {
  const userId = user.id;
  const rows = await prisma.product.findMany({
    where: productWhere(await getAccess(user)),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      description: true,
      ownerId: true,
      projects: { where: { status: { not: "space" }, deletedAt: null }, select: { id: true } },
      _count: { select: { nodes: true, requirements: { where: { archivedAt: null } } } },
    },
  });
  const joined = await prisma.product.count({ where: { status: { not: "archived" }, AND: [productWhere(await getAccess(user)), joinedProductWhere(userId)] } });
  return {
    counts: {
      joined,
      all: rows.filter((p) => p.status !== "archived").length,
      mine: rows.filter((p) => p.status !== "archived" && p.ownerId === userId).length,
      archived: rows.filter((p) => p.status === "archived").length,
    },
    products: rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      description: p.description || "",
      ownerId: p.ownerId || "",
      projectIds: p.projects.map((x) => x.id),
      counts: { nodes: p._count.nodes, requirements: p._count.requirements, projects: p.projects.length },
    })),
  };
}
