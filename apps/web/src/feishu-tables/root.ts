import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { LinkInput } from "@/lib/feishu-table-links";
import * as service from "@pm-collab/core/feishu-tables/root";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session);
  return NextResponse.json(response.body, response.init);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as LinkInput;
  const response = await service.POST(session, body);
  return NextResponse.json(response.body, response.init);
}
