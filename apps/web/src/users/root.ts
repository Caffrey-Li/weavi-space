import { NextResponse } from "next/server";
import { requireUserAdmin } from "@/lib/admin-gate";
import * as service from "@pm-collab/core/users/root";
import { publicOrigin } from "@pm-collab/core/login/links";

export async function GET() {
  const gate = await requireUserAdmin();
  if (gate.error) return gate.error;
  const response = await service.GET(gate.session);
  return NextResponse.json(response.body, response.init);
}

export async function POST(req: Request) {
  const gate = await requireUserAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(gate.session, body, publicOrigin(req.url, req.headers));
  return NextResponse.json(response.body, response.init);
}

export async function PATCH(req: Request) {
  const gate = await requireUserAdmin();
  if (gate.error) return gate.error;
  // Intentionally do NOT touch the admin session cookie here.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.PATCH(gate.session, body, publicOrigin(req.url, req.headers));
  return NextResponse.json(response.body, response.init);
}

/** 删除账号：只能删没有留下业务记录的账号；有记录的请停用，保留历史归属 */
export async function DELETE(req: Request) {
  const gate = await requireUserAdmin();
  if (gate.error) return gate.error;
  const response = await service.DELETE(gate.session, req.url);
  return NextResponse.json(response.body, response.init);
}
