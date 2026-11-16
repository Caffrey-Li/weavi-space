import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteSkill, skillDetail } from "@pm-collab/core/skills/service";

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await deleteSkill(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await skillDetail(s, decodeURIComponent((await props.params).id));
  return NextResponse.json(r.body, r.init);
}
