import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { GET as read, PUT as save } from "@pm-collab/core/api-tokens/admin";

export const dynamic = "force-dynamic";

/** T34 数据开放：GET ?scope=&userId=&page= 读策略、成员令牌、调用记录；PUT 保存策略 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await read(s, { scope: sp.get("scope"), userId: sp.get("userId"), page: sp.get("page") });
  return NextResponse.json(r.body, r.init);
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await save(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
