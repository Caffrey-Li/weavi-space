import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchDocs } from "@pm-collab/core/docs/search";

export const dynamic = "force-dynamic";

/** T36 文档检索：GET ?q=关键词（空格分开，都要出现）&spaceId=（可选） */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await searchDocs(s, { q: sp.get("q") || "", spaceId: sp.get("spaceId"), limit: Number(sp.get("limit")) || 30 });
  return NextResponse.json(r);
}
