import { result } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { PRODUCT_NODE_TYPES, canNest } from "../shared/products";


async function load(params: { id: string; nodeId: string }) {
  const node = await prisma.productNode.findUnique({ where: { id: params.nodeId } });
  return node && node.productId === params.id ? node : null;
}
export async function PATCH(params: { id: string; nodeId: string }, body: Record<string, unknown>) {
  const node = await load(params);
  if (!node) return result({ error: "节点不存在" }, { status: 404 });
  if (body.move === "up" || body.move === "down") {
    const siblings = await prisma.productNode.findMany({
      where: { productId: node.productId, parentId: node.parentId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const idx = siblings.findIndex((s) => s.id === node.id);
    const swap = body.move === "up" ? idx - 1 : idx + 1;
    if (swap >= 0 && swap < siblings.length) {
      [siblings[idx], siblings[swap]] = [siblings[swap], siblings[idx]];
      await prisma.$transaction(siblings.map((s, i) => prisma.productNode.update({ where: { id: s.id }, data: { sortOrder: i } })));
    }
    return result({ ok: true });
  }
  const data: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return result({ error: "请填写名称" }, { status: 400 });
    data.name = name;
  }
  if ("description" in body) data.description = body.description ? String(body.description).slice(0, 500) : null;
  if ("code" in body) data.code = body.code ? String(body.code).trim().slice(0, 40) || null : null;
  if ("ownerId" in body) {
    const ownerId = body.ownerId ? String(body.ownerId) : null;
    if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, isActive: true } }))) {
      return result({ error: "负责人不存在或已停用" }, { status: 400 });
    }
    data.ownerId = ownerId;
  }
  if ("type" in body && body.type !== node.type) {
    const type = String(body.type);
    if (!PRODUCT_NODE_TYPES.some((t) => t.key === type)) return result({ error: "节点类型无效" }, { status: 400 });
    const parentType = node.parentId ? (await prisma.productNode.findUnique({ where: { id: node.parentId }, select: { type: true } }))?.type ?? null : null;
    const kids = await prisma.productNode.findMany({ where: { parentId: node.id }, select: { type: true } });
    const nextParent = "parentId" in body ? undefined : parentType;
    if ((nextParent !== undefined && !canNest(nextParent, type)) || kids.some((k) => !canNest(type, k.type))) {
      return result({ error: "改成这个类型不符合层级规则（菜单 › 功能模块 › 功能点）" }, { status: 400 });
    }
    data.type = type;
    node.type = type;
  }
  if ("parentId" in body) {
    const parentId = body.parentId ? String(body.parentId) : null;
    if (parentId !== node.parentId) {
      let parentType: string | null = null;
      if (parentId) {
        const all = await prisma.productNode.findMany({ where: { productId: node.productId }, select: { id: true, parentId: true, type: true } });
        const parent = all.find((n) => n.id === parentId);
        if (!parent) return result({ error: "上级节点不存在" }, { status: 400 });
        for (let cur: string | null = parentId; cur; cur = all.find((n) => n.id === cur)?.parentId ?? null) {
          if (cur === node.id) return result({ error: "不能移到自己的下级" }, { status: 400 });
        }
        parentType = parent.type;
      }
      if (!canNest(parentType, node.type)) return result({ error: "该位置不能放这一类节点" }, { status: 400 });
      const last = await prisma.productNode.aggregate({ where: { productId: node.productId, parentId }, _max: { sortOrder: true } });
      data.parentId = parentId;
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    }
  }
  await prisma.productNode.update({ where: { id: node.id }, data });
  return result({ ok: true });
}

export async function DELETE(params: { id: string; nodeId: string }) {
  const node = await load(params);
  if (!node) return result({ error: "节点不存在" }, { status: 404 });
  const [children, reqs, bugs] = await Promise.all([
    prisma.productNode.count({ where: { parentId: node.id } }),
    prisma.requirement.count({ where: { productNodeId: node.id } }),
    prisma.bug.count({ where: { productNodeId: node.id } }),
  ]);
  if (children) return result({ error: `「${node.name}」下还有 ${children} 个下级，请先移走或删除` }, { status: 400 });
  if (reqs || bugs) {
    return result({ error: `「${node.name}」关联了 ${reqs + bugs} 条需求 / Bug，请先把它们改到其他模块` }, { status: 400 });
  }
  await prisma.productNode.delete({ where: { id: node.id } });
  return result({ ok: true });
}
