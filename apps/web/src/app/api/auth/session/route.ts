import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 11-24：页面定时确认会话还有效（体验账号到期、被停用或删除后自动退出）。只回最少的信息 */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, demoExpiresAt: s.demoExpiresAt ?? null }, { headers: { "Cache-Control": "no-store" } });
}
