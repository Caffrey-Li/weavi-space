import { result } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { PRODUCT_NODE_TYPES, canNest, productNodeTypeLabel } from "../shared/products";

export async function POST(params: { id: string }, body: Record<string, unknown>) {
  const name = String(body.name || "").trim().slice(0, 60);
  const type = String(body.type || "menu");
  const parentId = body.parentId ? String(body.parentId) : null;
  if (!name) return result({ error: "请填写名称" }, { status: 400 });
  if (!PRODUCT_NODE_TYPES.some((t) => t.key === type)) return result({ error: "节点类型无效" }, { status: 400 });
  const product = await prisma.product.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!product) return result({ error: "产品不存在" }, { status: 404 });
  let parentType: string | null = null;
  if (parentId) {
    const parent = await prisma.productNode.findUnique({ where: { id: parentId } });
    if (!parent || parent.productId !== product.id) return result({ error: "上级节点不存在" }, { status: 400 });
    parentType = parent.type;
  }
  if (!canNest(parentType, type)) {
    return result(
      { error: parentType ? `「${productNodeTypeLabel(parentType)}」下不能添加「${productNodeTypeLabel(type)}」` : "顶层只能是菜单或功能模块" },
      { status: 400 },
    );
  }
  const last = await prisma.productNode.aggregate({ where: { productId: product.id, parentId }, _max: { sortOrder: true } });
  const node = await prisma.productNode.create({
    data: {
      productId: product.id,
      parentId,
      type,
      name,
      code: body.code ? String(body.code).trim().slice(0, 40) || null : null,
      ownerId: body.ownerId ? String(body.ownerId) : null,
      description: body.description ? String(body.description).slice(0, 500) : null,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });
  await prisma.product.update({ where: { id: product.id }, data: { updatedAt: new Date() } });
  return result({ id: node.id });
}
