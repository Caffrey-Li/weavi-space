import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminGET, adminPUT } from "@pm-collab/core/login/service";

export const dynamic = "force-dynamic";

/** 设置 · 登录管理：系统超管管系统级和各企业，企业超管管本企业 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await adminGET(session, new URL(req.url).searchParams.get("scope"));
  return NextResponse.json(r.body, r.init);
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await adminPUT(session, body);
  return NextResponse.json(r.body, r.init);
}
