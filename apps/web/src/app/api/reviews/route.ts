import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listReviews, myPendingReviews, startReview } from "@pm-collab/core/reviews/service";

export const dynamic = "force-dynamic";

/** T38 评审：GET ?requirementId= | ?docPageId= | ?mine=1；POST 发起 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = sp.get("mine") ? await myPendingReviews(s) : await listReviews(s, { requirementId: sp.get("requirementId"), docPageId: sp.get("docPageId") });
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (s.isDemo) return NextResponse.json({ error: "体验账号只能查看" }, { status: 403 });
  const r = await startReview(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
