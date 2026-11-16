import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { LinkInput } from "@/lib/feishu-table-links";
import * as service from "@pm-collab/core/feishu-tables/id";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.PATCH(session, params, () => req.json().catch(() => ({})) as Promise<LinkInput>);
  return NextResponse.json(response.body, response.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.DELETE(session, params);
  return NextResponse.json(response.body, response.init);
}
