import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWikiStyleSetting, setWikiStyleSetting } from "@pm-collab/core/skills/wiki-style";

/** 个人开关：写进文档空间时按 Wiki 规范排版。GET { on, available }；POST { on } */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await getWikiStyleSetting(s.id));
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") return NextResponse.json({ error: "参数不对" }, { status: 400 });
  return NextResponse.json(await setWikiStyleSetting(s.id, body.on));
}
