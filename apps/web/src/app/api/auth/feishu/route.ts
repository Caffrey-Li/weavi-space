import { NextResponse } from "next/server";
import { cookieSecure } from "@/lib/auth";
import { FEISHU_FROM_COOKIE, FEISHU_STATE_COOKIE, feishuAuthorizeUrl, feishuRedirectUri, feishuSettings, safeFrom } from "@/lib/feishu-auth";

export const dynamic = "force-dynamic";


/** GET ?check=1：返回是否已开通；否则跳到飞书授权页 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await feishuSettings();
  if (url.searchParams.get("check")) return NextResponse.json({ configured: Boolean(cfg) });
  if (!cfg) {
    return NextResponse.redirect(new URL("/login?feishu_error=unconfigured", req.url));
  }
  const state = crypto.randomUUID();
  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 600, secure: await cookieSecure() };
  const res = NextResponse.redirect(feishuAuthorizeUrl(cfg.appId, state, feishuRedirectUri(req, cfg.redirectUri)));
  res.cookies.set(FEISHU_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(FEISHU_FROM_COOKIE, safeFrom(url.searchParams.get("from")), cookieOpts);
  return res;
}
