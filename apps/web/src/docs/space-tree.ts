import { jsonError } from "@/lib/docs-api";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/docs/space-tree";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const raw = await service.GET(session, params);
  if (raw instanceof NextResponse) return raw;
  if (raw) return NextResponse.json(raw.body, raw.init);
  return jsonError("未登录", 401);
}
