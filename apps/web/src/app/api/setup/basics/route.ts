import { NextResponse } from "next/server";
import { getSession } from "@pm-collab/core/auth";
import { saveBasics } from "@pm-collab/core/setup/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 首次安装第 3 步：系统名称、第一个企业（系统超管，都可选） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await saveBasics(session, body);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
