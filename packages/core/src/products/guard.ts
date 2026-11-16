import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { getAccess, productWhere } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../requirements/result";

export async function guardProductWrite(session: SessionUser, productId: string) {
  const visible = await prisma.product.count({ where: { id: productId, AND: [productWhere(await getAccess(session))] } });
  if (!visible) return result({ error: "产品不存在" }, { status: 404 });
  if (!(await can(session, "products.manage"))) return result({ error: "无权限维护产品" }, { status: 403 });
  return null;
}
