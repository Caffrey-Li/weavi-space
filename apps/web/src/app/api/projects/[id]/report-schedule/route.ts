import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveSchedule } from "@pm-collab/core/reports/service";

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await saveSchedule(s, (await props.params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
