import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reviewAction } from "@pm-collab/core/reviews/service";

export const dynamic = "force-dynamic";

/** T38：{ action: "vote", verdict, comment } | { action: "cancel" } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (s.isDemo) return NextResponse.json({ error: "体验账号只能查看" }, { status: 403 });
  const r = await reviewAction(s, (await props.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
