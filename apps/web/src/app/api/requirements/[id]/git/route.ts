import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createBranch, requirementCode } from "@pm-collab/core/git/service";

export const dynamic = "force-dynamic";

/** 需求关联的代码（T44） */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const d = await requirementCode(s, (await props.params).id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "需求不存在" }, { status: 404 });
}

/** 建分支：{ repoId, name?, taskId? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await createBranch(s, (await props.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
