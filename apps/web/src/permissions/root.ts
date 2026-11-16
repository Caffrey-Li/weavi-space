import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireSystemAdmin } from "@/lib/admin-gate";
import * as service from "@pm-collab/core/permissions/root";

/** 角色功能权限（scope=role）。完整的角色配置见 /api/roles */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session);
  return NextResponse.json(response.body, response.init);
}

/** 单项开关：{ role, feature, allowed } */
export async function PATCH(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(gate.session, body);
  return NextResponse.json(response.body, response.init);
}
