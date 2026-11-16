import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { applyGenerated, generateStructure, type ApplyNode } from "./structure-gen";
import { result } from "../requirements/result";

export async function findProductForStructure(id: string) {
  return prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
}

export async function POST(session: SessionUser, product: { id: string }, body: { docs?: boolean; reqs?: boolean; apply?: ApplyNode[] }) {
  try {
    if (Array.isArray(body.apply)) {
      const res = await applyGenerated(product.id, body.apply);
      await prisma.activityLog.create({
        data: { entityType: "product", entityId: product.id, action: "structure_generated", actorId: session.id, message: `自动生成功能结构，新增 ${res.created} 个节点` },
      });
      return result(res);
    }
    const src = { docs: body.docs !== false, reqs: body.reqs !== false };
    if (!src.docs && !src.reqs) return result({ error: "至少选择一个来源" }, { status: 400 });
    return result(await generateStructure(product.id, src));
  } catch (e) {
    console.error("[功能结构生成]", e);
    return result({ error: "生成失败，请稍后重试" }, { status: 500 });
  }
}
