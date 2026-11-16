import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runSkill } from "@pm-collab/core/skills/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await runSkill(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
