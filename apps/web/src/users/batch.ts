import { NextResponse } from "next/server";
import { requireUserAdmin } from "@/lib/admin-gate";
import * as service from "@pm-collab/core/users/batch";

/**
 * 批量调整成员：{ ids: string[], orgId?, globalRole?, position? }，只改传了的字段。
 * position 传空字符串表示清空默认岗位。不改动已有的项目内岗位。
 */
export async function PATCH(req: Request) {
  const gate = await requireUserAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(gate.session, body);
  return NextResponse.json(response.body, response.init);
}
