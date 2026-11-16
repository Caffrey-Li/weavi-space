import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireSystemAdmin } from "@/lib/admin-gate";
import * as service from "@pm-collab/core/positions/root";

/** 岗位列表 + 默认岗位人数 + 项目内任职人数 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session);
  return NextResponse.json(response.body, response.init);
}

export async function POST(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(gate.session, body);
  return NextResponse.json(response.body, response.init);
}

/** 改名 / 改说明 / 调整顺序（order: 全部岗位 id 的新顺序） */
export async function PATCH(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(gate.session, body);
  return NextResponse.json(response.body, response.init);
}

/** 删除岗位：内置岗位不能删；仍有人以它为默认岗位或在项目中任职时不能删 */
export async function DELETE(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const response = await service.DELETE(gate.session, req.url);
  return NextResponse.json(response.body, response.init);
}
