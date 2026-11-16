import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { startSession } from "@/lib/auth";
import {
  FEISHU_FROM_COOKIE,
  FEISHU_STATE_COOKIE,
  FeishuLoginError,
  feishuRedirectUri,
  feishuSettings,
  loginWithFeishuCode,
  safeFrom,
} from "@/lib/feishu-auth";
import { clientIp, hitIp } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

/** 飞书授权回调：限流 → 校验 state → 换令牌 → 取用户 → 登录 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ip = clientIp(req.headers);
  const cfg = await feishuSettings();
  const redirectUri = feishuRedirectUri(req, cfg?.redirectUri);
  const base = new URL(redirectUri).origin;
  const fail = (reason: string) => {
    const to = new URL("/login", base);
    to.searchParams.set("feishu_error", reason);
    return NextResponse.redirect(to);
  };

  if (hitIp(ip, "feishu")) {
    await securityLog("feishu_ip_limited", "-", ip);
    return fail("rate");
  }
  if (!cfg) return fail("unconfigured");
  const jar = await cookies();
  const expected = jar.get(FEISHU_STATE_COOKIE)?.value;
  const from = safeFrom(jar.get(FEISHU_FROM_COOKIE)?.value);
  jar.delete(FEISHU_STATE_COOKIE);
  jar.delete(FEISHU_FROM_COOKIE);

  const code = url.searchParams.get("code");
  if (!code) return fail(url.searchParams.get("error") === "access_denied" ? "denied" : "nocode");
  if (!expected || expected !== url.searchParams.get("state")) {
    await securityLog("feishu_state_mismatch", "-", ip);
    return fail("state");
  }

  try {
    const user = await loginWithFeishuCode(cfg, code, redirectUri);
    await startSession(user.id, true);
    await securityLog("feishu_login_success", user.email, ip, user.id);
    return NextResponse.redirect(new URL(from, base));
  } catch (e) {
    if (e instanceof FeishuLoginError) {
      await securityLog("feishu_login_failed", "-", ip, null, e.reason);
      return fail(e.reason);
    }
    console.error("feishu login failed", e);
    return fail("server");
  }
}
