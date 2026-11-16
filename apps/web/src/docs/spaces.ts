import { jsonError } from "@/lib/docs-api";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/docs/spaces";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const raw = await service.GET(session);
  if (raw instanceof NextResponse) return raw;
  if (raw) return NextResponse.json(raw.body, raw.init);
  return jsonError("未登录", 401);
}
