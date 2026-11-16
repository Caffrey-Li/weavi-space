import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createTemplate, listTemplates } from "@pm-collab/core/workbench/templates";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await listTemplates(s, sp.get("kind") || "", sp.get("projectId"));
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await createTemplate(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
