import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reviewCandidates } from "@pm-collab/core/reviews/service";

export const dynamic = "force-dynamic";

/** T38：可选评审人（项目成员；公共池需求为本企业的人） */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await reviewCandidates(s, { requirementId: sp.get("requirementId"), docPageId: sp.get("docPageId") });
  return NextResponse.json(r.body, r.init);
}
