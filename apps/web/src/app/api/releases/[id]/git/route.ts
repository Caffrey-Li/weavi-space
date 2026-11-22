import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addToRelease, compareRelease, releaseRefs } from "@pm-collab/core/git/service";

export const dynamic = "force-dynamic";

/** 发版代码对比的选项：仓库、标签、分支（?repoId=） */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const d = await releaseRefs(s, (await props.params).id, new URL(req.url).searchParams.get("repoId") || undefined);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "发版不存在" }, { status: 404 });
}

/** { action: "compare", repoId, from, to } | { action: "add", requirementIds } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const id = (await props.params).id;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "add" ? await addToRelease(s, id, body) : await compareRelease(s, id, { repoId: String(body.repoId || ""), from: String(body.from || ""), to: String(body.to || "") });
  return NextResponse.json(r.body, r.init);
}
