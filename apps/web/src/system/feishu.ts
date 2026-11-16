import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/system/feishu";

/** 未登录也走服务内 admin 判定，保持原 403（不是 401） */
export async function GET(req: Request) {
  const session = await getSession();
  const response = await service.GET(session, req);
  return NextResponse.json(response.body, response.init);
}

export async function PUT(req: Request) {
  const session = await getSession();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PUT(session, req, body);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(req: Request) {
  const session = await getSession();
  const response = await service.DELETE(session, req);
  return NextResponse.json(response.body, response.init);
}
