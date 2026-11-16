import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardProductWrite } from "@pm-collab/core/products/guard";
import * as service from "@pm-collab/core/products/id-nodes";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await service.POST(params, body);
  return NextResponse.json(response.body, response.init);
}
