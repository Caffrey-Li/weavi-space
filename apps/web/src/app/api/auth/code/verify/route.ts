import { NextResponse } from "next/server";
import { startSession } from "@/lib/auth";
import { verifyLoginCode } from "@pm-collab/core/login/service";
import { clientIp, hitIp } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

/** 验证码登录：成功开会话；还没设密码的账号登录后去设置密码 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const wait = hitIp(ip, "login-code");
  if (wait) return NextResponse.json({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await verifyLoginCode(body);
  if ("error" in r) {
    await securityLog("login_code_failed", String(body.channel || "-"), ip);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  await startSession(r.user.id, body.remember === true);
  await securityLog("login_code_success", r.user.email, ip, r.user.id);
  return NextResponse.json({ ok: true, mustChangePassword: r.user.mustChangePassword || !r.user.passwordHash });
}
