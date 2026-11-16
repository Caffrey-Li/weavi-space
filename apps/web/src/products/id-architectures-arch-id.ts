import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardProductWrite } from "@pm-collab/core/products/guard";
import { readArchForm } from "@pm-collab/core/products/architecture-write";
import * as service from "@pm-collab/core/products/id-architectures-arch-id";

export async function PATCH(req: Request, props: { params: Promise<{ id: string; archId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const form = await readArchForm(req);
  const response = await service.PATCH(session, params, form);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; archId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const response = await service.DELETE(session, params);
  return NextResponse.json(response.body, response.init);
}
