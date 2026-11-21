import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { projectGET, projectPUT } from "@pm-collab/core/flow/service";

export const dynamic = "force-dynamic";

/** T41 项目研发流程：GET；PUT { hidden?, reviewRequired?: boolean | null, migrate? } */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await projectGET(s, (await ctx.params).id);
  return NextResponse.json(r.body, r.init);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await projectPUT(s, (await ctx.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
