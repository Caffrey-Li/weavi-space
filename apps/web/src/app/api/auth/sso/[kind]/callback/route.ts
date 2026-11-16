import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { startSession } from "@/lib/auth";
import { clientIp, hitIp } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { SSO_KINDS, providerConfig, type SsoKind } from "@pm-collab/core/login/providers";
import { SsoError, exchangeCode, resolveSsoUser, ssoRedirectUri } from "@pm-collab/core/login/sso";
import { peekLinkToken, consumeLinkToken } from "@pm-collab/core/login/tokens";

export const dynamic = "force-dynamic";
const SSO_COOKIE = "pm_sso_state";

/** 授权回调：校验 state → 换取第三方用户 → 找账号（可凭邀请 / 重置链接绑定）→ 开会话 */
export async function GET(req: Request, props: { params: Promise<{ kind: string }> }) {
  const { kind } = await props.params;
  const url = new URL(req.url);
  const ip = clientIp(req.headers);
  const jar = await cookies();
  const raw = jar.get(SSO_COOKIE)?.value;
  jar.delete(SSO_COOKIE);
  let st: { state: string; kind: string; scope: string; org: string; from: string; link: string } | null = null;
  try {
    st = raw ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) : null;
  } catch {
    st = null;
  }
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?sso_error=${reason}${st?.org ? `&org=${encodeURIComponent(st.org)}` : ""}`, req.url));
  if (hitIp(ip, "sso")) return fail("rate");
  if (!(SSO_KINDS as readonly string[]).includes(kind) || !st || st.kind !== kind || st.state !== url.searchParams.get("state")) {
    await securityLog("sso_state_mismatch", kind, ip);
    return fail("state");
  }
  const code = url.searchParams.get("code") || url.searchParams.get("authCode");
  if (!code) return fail("denied");
  const p = await providerConfig(st.scope, kind as SsoKind);
  if (!p?.enabled) return fail("unconfigured");
  try {
    const ext = await exchangeCode(kind as SsoKind, p.config, code, ssoRedirectUri(req, kind as SsoKind));
    const link = st.link ? await peekLinkToken(st.link) : null;
    const user = await resolveSsoUser(kind as SsoKind, st.scope, ext, link?.userId);
    if (link && link.userId === user.id) await consumeLinkToken(link.id);
    await startSession(user.id, true);
    await securityLog("sso_login_success", `${kind}:${user.email}`, ip, user.id);
    const needPassword = user.mustChangePassword || !user.passwordHash;
    return NextResponse.redirect(new URL(needPassword ? "/settings?force=1" : st.from || "/", req.url));
  } catch (e) {
    const reason = e instanceof SsoError ? e.reason : "server";
    if (!(e instanceof SsoError)) console.error("sso login failed", e);
    await securityLog("sso_login_failed", kind, ip, null, reason);
    return fail(reason);
  }
}
