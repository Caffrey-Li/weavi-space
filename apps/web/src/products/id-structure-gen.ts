import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { ApplyNode } from "@/lib/product-structure-gen";
import { guardProductWrite } from "@pm-collab/core/products/guard";
import * as service from "@pm-collab/core/products/id-structure-gen";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const product = await service.findProductForStructure(params.id);
  if (!product) return NextResponse.json({ error: "产品不存在" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { docs?: boolean; reqs?: boolean; apply?: ApplyNode[] };
  const response = await service.POST(session, product, body);
  return NextResponse.json(response.body, response.init);
}
