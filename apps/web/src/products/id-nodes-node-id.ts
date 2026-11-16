import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardProductWrite } from "@pm-collab/core/products/guard";
import * as service from "@pm-collab/core/products/id-nodes-node-id";

export async function PATCH(req: Request, props: { params: Promise<{ id: string; nodeId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(params, body);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; nodeId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const response = await service.DELETE(params);
  return NextResponse.json(response.body, response.init);
}
