import { NextResponse } from "next/server";
import { sendLoginCode } from "@pm-collab/core/login/service";
import { clientIp, hitIp } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

/** 发送登录验证码（邮箱 / 短信）：按 IP 限流，结果不透露账号是否存在 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const wait = hitIp(ip, "login-code");
  if (wait) {
    await securityLog("login_code_ip_limited", "-", ip);
    return NextResponse.json({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await sendLoginCode(body);
  return NextResponse.json(r.body, r.init);
}
