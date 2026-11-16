import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/feishu-tables/inspect";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { url?: string; tableId?: string; headerRow?: number };
  const response = await service.POST(session, body);
  return NextResponse.json(response.body, response.init);
}
