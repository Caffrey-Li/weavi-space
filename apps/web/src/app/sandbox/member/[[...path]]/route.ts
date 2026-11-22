import { MEMBER_SITE_HTML } from "@/lib/sandbox/member-site";


/** T55 会员体系测试站：所有路径都返回同一个单页应用（前端按地址渲染），不读库、不需要登录 */
export function GET() {
  return new Response(MEMBER_SITE_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}
