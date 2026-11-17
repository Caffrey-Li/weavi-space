import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { loginWithDemoLink } from "@pm-collab/core/demo/guests";
import { clientIp } from "@pm-collab/core/shared/rate-limit";

export const dynamic = "force-dynamic";

/** 用体验链接登录（公开接口）：POST { token } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const r = await loginWithDemoLink(String(body.token ?? ""), clientIp(await headers()));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
