import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSkills, saveSkill } from "@pm-collab/core/skills/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await listSkills(s);
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await saveSkill(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
