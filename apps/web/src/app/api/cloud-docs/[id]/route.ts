import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteLink, updateLink } from "@pm-collab/core/cloud-docs/service";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await updateLink(s, (await props.params).id, body);
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await deleteLink(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
