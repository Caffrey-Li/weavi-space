import { NextResponse } from "next/server";
import { clearSessionCookie, endCurrentSession, getSession } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-path";
import { securityLog } from "@/lib/security-log";

export async function POST(req: Request) {
  const session = await getSession();
  await endCurrentSession();
  if (session) await securityLog("logout", session.email, clientIp(req.headers), session.id);
  return NextResponse.json({ ok: true });
}

/**
 * 会话在服务端已失效（账号停用、改过密码）但浏览器还带着旧 Cookie 时，页面会跳到这里：
 * 清掉 Cookie 再回登录页，避免中间件和页面之间来回跳转。只跳本站路径。
 * 会话还有效时什么都不做，否则别的网站放一个链接就能把用户登出。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (await getSession()) return NextResponse.redirect(new URL("/", url.origin));
  await clearSessionCookie();
  return NextResponse.redirect(new URL(safeRedirectPath(url.searchParams.get("next"), "/login"), url.origin));
}
