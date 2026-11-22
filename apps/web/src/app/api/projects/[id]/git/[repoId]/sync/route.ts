import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { syncNow } from "@pm-collab/core/git/service";

/** 立即拉取一次 */
export async function POST(_req: Request, props: { params: Promise<{ id: string; repoId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, repoId } = await props.params;
  const r = await syncNow(s, id, repoId);
  return NextResponse.json(r.body, r.init);
}
