import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateAction, updateStatus } from "@pm-collab/core/skills/updater";

/** 内置能力在线更新：GET 版本和上次检查；POST { action: "check" } 立即检查更新、{ action: "auto", on } 开关自动更新（系统超管） */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await updateStatus(s);
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await updateAction(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
