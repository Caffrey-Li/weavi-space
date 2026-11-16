import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/system/settings";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session);
  return NextResponse.json(response.body, response.init);
}

/** 更新系统设置：只有系统管理员可以改（校验在服务内、admin 检查之前完成） */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PUT(session, body);
  return NextResponse.json(response.body, response.init);
}
