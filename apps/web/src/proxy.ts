import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CLIENT_IP_HEADER, edgeClientIp, trustNetlifyIp } from "@/lib/client-ip";
import { allowedWhileForcedChange } from "@/lib/force-change";
import { originAllowed } from "@/lib/origin-check";
import { checkPageSession, isDemoSession } from "@/lib/session-check";

/**
 * Next 16 的 proxy（原 middleware），跑在 Node 运行时。
 * 页面：这里查库校验会话（伪造、吊销、停用、过期、强制改密）。页面和布局并行渲染，布局里的校验挡不住页面内容，必须在渲染前拦。
 * 接口：每个路由自己调 getSession，这里只看有没有 Cookie。
 */
const COOKIE = "pm_session";
const PUBLIC = ["/login", "/forgot-password", "/invite", "/api/auth/guest", "/api/auth/login", "/api/auth/feishu", "/api/auth/sso", "/api/auth/code", "/api/auth/invite", "/api/auth/login-options", "/api/healthz"];
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UPLOAD_FILE = /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif|svg)$/;
const isDev = process.env.NODE_ENV !== "production";

/** 页面的 CSP：脚本只认本次请求的 nonce，不再需要 'unsafe-inline'。React 的 style 属性需要 style-src 的 'unsafe-inline' */
function pageCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // 开放接口 v1 和 MCP 只认 Bearer 令牌（不带 Cookie、不做 Origin 校验）
  const isApiV1 = pathname === "/api/v1" || pathname.startsWith("/api/v1/") || pathname === "/api/mcp";

  // 跨站写请求一律拒绝（CSRF），放在最前面，后面的放行分支都绕不过去
  if (
    !isApiV1 && WRITE_METHODS.has(req.method) &&
    !originAllowed({
      origin: req.headers.get("origin"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      trustProxy: process.env.TRUST_PROXY === "1",
      siteUrls: [process.env.APP_URL, process.env.URL],
    })
  ) {
    return NextResponse.json({ error: "跨站请求已被拒绝" }, { status: 403 });
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = pageCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  // 这两个头总是覆盖，客户端传来的值无效；getSession 靠 x-pm-path 判断强制改密时能否访问
  requestHeaders.set("x-pm-path", pathname);
  // 演示访客只读：getSession 按请求方法拒绝写操作
  requestHeaders.set("x-pm-method", req.method);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.delete(CLIENT_IP_HEADER);
  const edgeIp = trustNetlifyIp() ? edgeClientIp(req.headers) : null;
  if (edgeIp) requestHeaders.set(CLIENT_IP_HEADER, edgeIp);
  if (!isApi) requestHeaders.set("Content-Security-Policy", csp);

  const pass = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    if (!isApi) res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // v1 只使用 Bearer；剥除 Cookie，避免未来路由意外回退到会话认证。
  if (isApiV1) {
    requestHeaders.delete("cookie");
    return pass();
  }

  // Runtime-uploaded avatars: next start only serves public/ files present at boot.
  // Rewrite to an API that reads from disk so new uploads work without restart.
  for (const [prefix, target] of [
    ["/uploads/avatars/", "/api/auth/avatar/file/"],
    ["/uploads/projects/", "/api/projects/icon/file/"],
  ]) {
    if (pathname.startsWith(prefix)) {
      const filename = pathname.slice(prefix.length);
      if (!UPLOAD_FILE.test(filename)) return NextResponse.json({ error: "无效文件" }, { status: 400 });
      const url = req.nextUrl.clone();
      url.pathname = `${target}${filename}`;
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    }
  }

  // 静态资源。/api 不走这里，否则 /api/xxx.png 这样的地址能绕过下面的登录判断
  if (!isApi && (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/excalidraw-assets/") || /\.(png|jpg|jpeg|gif|svg|ico|webp)$/.test(pathname))) {
    return pass();
  }

  // 项目只读分享页：不需要登录，登录了也不跳转；页面和接口凭链接里的令牌自己校验
  if (pathname.startsWith("/share/") || pathname.startsWith("/api/share/")) return pass();

  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasCookie = req.cookies.has(COOKIE);

  if (!hasCookie && !isPublic) {
    if (isApi) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // 演示站：只读访客的写请求在这里直接拒绝，给出明确提示（getSession 里还有一道兜底）
  if (process.env.GUEST_DEMO === "1" && hasCookie && isApi && WRITE_METHODS.has(req.method) && pathname !== "/api/auth/logout" && (await isDemoSession(req.cookies.get(COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "演示访客只能查看，不能新建或修改" }, { status: 403 });
  }

  if (hasCookie && !isApi) {
    const state = await checkPageSession(req.cookies.get(COOKIE)?.value || "");
    const redirectTo = (path: string, search = "") => {
      const url = req.nextUrl.clone();
      url.pathname = path;
      url.search = search;
      return NextResponse.redirect(url);
    };
    if (isPublic) {
      // 登录页：有效会话回首页，失效的 Cookie 留着也无妨，重新登录时会覆盖
      if (state !== "invalid") return redirectTo("/");
    } else if (state === "invalid") {
      return redirectTo("/api/auth/logout", "?next=/login");
    } else if (state === "must-change" && !allowedWhileForcedChange(pathname)) {
      return redirectTo("/settings", "?force=1");
    }
  }

  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
