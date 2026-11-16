/**
 * 站内跳转地址校验（中间件、服务端、浏览器共用，不能引入 prisma）。
 * 只看开头是不够的：浏览器和 URL 解析都把反斜杠当斜杠、会吞掉制表符和换行，
 * 「/\evil.com」「/<TAB>/evil.com」最终都会跳到外站，所以这里按真实解析结果判断。
 */
const BASE = "http://internal.invalid";

export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, BASE);
    return u.origin === BASE ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
