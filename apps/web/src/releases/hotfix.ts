import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/releases/hotfix";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  const response = await service.GET(session, projectId);
  return NextResponse.json(response.body, response.init);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(session, body);
  return NextResponse.json(response.body, response.init);
}
