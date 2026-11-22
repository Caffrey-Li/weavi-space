import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteArtifact, updateArtifact } from "@pm-collab/core/requirements/artifacts";

/** 改标题 / 版本说明 / 是否显示在子需求 */
export async function PATCH(req: Request, props: { params: Promise<{ id: string; artifactId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, artifactId } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await updateArtifact(s, id, artifactId, body);
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; artifactId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, artifactId } = await props.params;
  const r = await deleteArtifact(s, id, artifactId);
  return NextResponse.json(r.body, r.init);
}
