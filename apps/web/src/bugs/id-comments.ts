import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/bugs/id-comments";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session, params);
  return NextResponse.json(response.body, response.init);
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(session, params, body);
  return NextResponse.json(response.body, response.init);
}
