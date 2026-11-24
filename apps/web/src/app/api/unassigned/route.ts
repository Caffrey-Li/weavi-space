import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listUnassigned, moveUnassigned } from "@pm-collab/core/requirements/unassigned";

/** 未归属项目的需求 / Bug：GET 列表，POST { kind, ids, projectId } 分到项目 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await listUnassigned(session));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await moveUnassigned(session, body);
  return NextResponse.json(r.body, r.init);
}
