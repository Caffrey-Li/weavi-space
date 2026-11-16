import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeShareLink } from "@pm-collab/core/share/service";

export const dynamic = "force-dynamic";

/** 作废分享链接 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, linkId } = await ctx.params;
  const r = await revokeShareLink(session, id, linkId);
  return NextResponse.json(r.body, r.init);
}
