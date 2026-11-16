import { jsonError } from "@/lib/docs-api";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/docs/page-publish";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const raw = await service.POST(session, params, { url: req.url, body });
  if (raw instanceof NextResponse) return raw;
  if (raw) return NextResponse.json(raw.body, raw.init);
  return jsonError("未登录", 401);
}
