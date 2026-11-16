import { NextResponse } from "next/server";
import { cookieSecure } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-path";
import { SSO_KINDS, providerConfig, complete, type SsoKind } from "@pm-collab/core/login/providers";
import { authorizeUrl, ssoRedirectUri } from "@pm-collab/core/login/sso";
import { scopeFromOrgCode } from "@pm-collab/core/login/service";

export const dynamic = "force-dynamic";
const SSO_COOKIE = "pm_sso_state";

/** 跳到飞书 / 企业微信 / 钉钉授权页：?org=<企业编码>&from=&link=<邀请或重置链接令牌> */
export async function GET(req: Request, props: { params: Promise<{ kind: string }> }) {
  const { kind } = await props.params;
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  const back = (reason: string) => NextResponse.redirect(new URL(`/login?sso_error=${reason}${org ? `&org=${encodeURIComponent(org)}` : ""}`, req.url));
  if (!(SSO_KINDS as readonly string[]).includes(kind)) return back("unconfigured");
  const { scope } = await scopeFromOrgCode(org);
  const p = await providerConfig(scope, kind as SsoKind);
  if (!p?.enabled || !complete(kind as SsoKind, p.config)) return back("unconfigured");
  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, kind, scope, org: org || "", from: safeRedirectPath(url.searchParams.get("from")), link: (url.searchParams.get("link") || "").slice(0, 100) });
  const res = NextResponse.redirect(authorizeUrl(kind as SsoKind, p.config, state, ssoRedirectUri(req, kind as SsoKind)));
  res.cookies.set(SSO_COOKIE, Buffer.from(payload).toString("base64url"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: await cookieSecure() });
  return res;
}
