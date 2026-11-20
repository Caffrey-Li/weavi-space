import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ceilingGET, ceilingPUT } from "@pm-collab/core/roles/root";

export const dynamic = "force-dynamic";

/** T37 企业权限上限（只有系统超管）：GET ?enterpriseId=；PUT { enterpriseId, features } */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await ceilingGET(s, new URL(req.url).searchParams.get("enterpriseId") || "");
  return NextResponse.json(r.body, r.init);
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await ceilingPUT(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
