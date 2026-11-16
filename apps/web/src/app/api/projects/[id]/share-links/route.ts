import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createShareLink, listShareLinks } from "@pm-collab/core/share/service";

export const dynamic = "force-dynamic";

/** 项目只读分享链接：列表 / 新建（需要「编辑项目」权限） */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await listShareLinks(session, (await ctx.params).id);
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "参数错误" }, { status: 400 });
  const r = await createShareLink(session, (await ctx.params).id, body);
  return NextResponse.json(r.body, r.init);
}
