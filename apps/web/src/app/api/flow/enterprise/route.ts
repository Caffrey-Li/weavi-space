import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enterpriseGET, enterprisePUT } from "@pm-collab/core/flow/service";

export const dynamic = "force-dynamic";

/** T41 企业研发流程：GET ?enterpriseId=（只对系统超管有效）；PUT { enterpriseId?, hidden, labels, reviewRequired, allowProjectStages, allowProjectReview, migrate } */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await enterpriseGET(s, new URL(req.url).searchParams.get("enterpriseId") || null);
  return NextResponse.json(r.body, r.init);
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await enterprisePUT(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
