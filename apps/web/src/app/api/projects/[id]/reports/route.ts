import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveReport } from "@pm-collab/core/reports/service";

/** 写 / 改周报（项目编辑权限） */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await saveReport(s, (await props.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
