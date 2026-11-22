import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bindRepo, projectRepos } from "@pm-collab/core/git/service";

export const dynamic = "force-dynamic";

/** 项目绑定的代码仓库（T44） */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const d = await projectRepos(s, (await props.params).id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}

/** 绑定：{ connectionId, path, afterMerge?, tagPattern? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await bindRepo(s, (await props.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
