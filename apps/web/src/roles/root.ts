import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireSystemAdmin } from "@/lib/admin-gate";
import * as service from "@pm-collab/core/roles/root";

/** 角色列表：名称、数据范围、功能权限、人数 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.GET(session);
  return NextResponse.json(response.body, response.init);
}

/** 新建角色：可从已有角色复制功能权限与数据范围 */
export async function POST(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(gate.session, body);
  return NextResponse.json(response.body, response.init);
}

/** 修改角色：名称、说明、数据范围、功能权限（系统管理员不可改权限和数据范围） */
export async function PATCH(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(gate.session, body);
  return NextResponse.json(response.body, response.init);
}

/** 删除角色：系统内置角色不能删；还有人用的角色先把人调到别的角色 */
export async function DELETE(req: Request) {
  const gate = await requireSystemAdmin();
  if (gate.error) return gate.error;
  const response = await service.DELETE(gate.session, req.url);
  return NextResponse.json(response.body, response.init);
}
