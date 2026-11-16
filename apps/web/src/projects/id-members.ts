import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/projects/id-members";

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
  // can 在 json 解析前：由服务内先 can，再调用 getBody
  const response = await service.POST(session, params, () => req.json().catch(() => ({})) as Promise<Record<string, unknown>>);
  return NextResponse.json(response.body, response.init);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.PATCH(session, params, () => req.json().catch(() => ({})) as Promise<Record<string, unknown>>);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.DELETE(session, params, () => req.json().catch(() => ({})) as Promise<Record<string, unknown>>);
  return NextResponse.json(response.body, response.init);
}
