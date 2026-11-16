import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createLink, listLinks } from "@pm-collab/core/cloud-docs/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await listLinks(s);
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await createLink(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
