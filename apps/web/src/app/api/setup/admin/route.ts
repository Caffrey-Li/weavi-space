import { NextResponse } from "next/server";
import { startSession } from "@pm-collab/core/auth";
import { createFirstAdmin } from "@pm-collab/core/setup/service";
import { clientIp, hitIp } from "@pm-collab/core/shared/rate-limit";

export const dynamic = "force-dynamic";

/** 首次安装第 2 步：凭安装码创建第一个超级管理员并直接登录 */
export async function POST(req: Request) {
  const wait = hitIp(clientIp(req.headers), "setup");
  if (wait) return NextResponse.json({ error: `尝试次数太多，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await createFirstAdmin({ code: body.code, name: body.name, email: body.email, password: body.password });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  await startSession(r.userId, true);
  return NextResponse.json({ ok: true });
}
