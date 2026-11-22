import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteConnection, saveConnection } from "@pm-collab/core/git/service";

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await saveConnection(s, { ...body, id: (await props.params).id });
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await deleteConnection(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
