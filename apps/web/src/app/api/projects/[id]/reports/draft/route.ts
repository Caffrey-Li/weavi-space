import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { draftReport } from "@pm-collab/core/reports/service";

export const dynamic = "force-dynamic";

/** 按本周数据起草周报（只读，不保存） */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await draftReport(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
