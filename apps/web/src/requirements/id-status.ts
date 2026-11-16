import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/requirements/id-status";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const response = await service.PATCH(session, params, body);
  return NextResponse.json(response.body, response.init);
}
