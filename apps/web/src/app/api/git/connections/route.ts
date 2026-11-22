import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listConnections, saveConnection } from "@pm-collab/core/git/service";

export const dynamic = "force-dynamic";

/** 代码仓库连接（T44）：企业超管 / 系统超管管理；其他人只看本企业的连接名称 */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await listConnections(s));
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await saveConnection(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
