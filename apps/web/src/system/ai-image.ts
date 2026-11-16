import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/system/ai-image";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  // 编辑项目时只问这个项目所属企业有没有配置（任何能看到项目的人）
  const response = sp.get("project") ? await service.readyForProject(s, sp.get("project")!) : await service.GET(s, sp.get("scope"));
  return NextResponse.json(response.body, response.init);
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PUT(s, body);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.DELETE(s, new URL(req.url).searchParams.get("scope"));
  return NextResponse.json(response.body, response.init);
}
