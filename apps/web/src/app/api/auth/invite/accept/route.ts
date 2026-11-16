import { NextResponse } from "next/server";
import { startSession } from "@/lib/auth";
import { acceptLink } from "@pm-collab/core/login/service";
import { clientIp, hitIp } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

/** 凭邀请 / 重置链接登录：{ token, account }，账号邮箱或手机号要和链接对应的账号一致 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const wait = hitIp(ip, "invite");
  if (wait) return NextResponse.json({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await acceptLink(String(body.token || ""), String(body.account || ""));
  if ("error" in r) {
    await securityLog("invite_accept_failed", "-", ip);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  await startSession(r.user.id, true);
  await securityLog(r.purpose === "reset" ? "reset_link_login" : "invite_accepted", r.user.email, ip, r.user.id);
  return NextResponse.json({ ok: true });
}
