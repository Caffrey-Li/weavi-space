import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { unbindRepo, updateRepo } from "@pm-collab/core/git/service";

export async function PATCH(req: Request, props: { params: Promise<{ id: string; repoId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, repoId } = await props.params;
  const r = await updateRepo(s, id, repoId, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; repoId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, repoId } = await props.params;
  const r = await unbindRepo(s, id, repoId);
  return NextResponse.json(r.body, r.init);
}
