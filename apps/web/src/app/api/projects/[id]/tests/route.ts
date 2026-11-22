import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createCasesPage } from "@pm-collab/core/delivery/standalone-cases";

/** 项目 · 测试（T42）：新建用例页 { title, requirementId? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await createCasesPage(s, (await props.params).id, body);
  return NextResponse.json(r.body, r.init);
}
