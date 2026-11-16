/**
 * 写接口的跨站校验（Edge 中间件用，不能引入 prisma）。
 * 浏览器发 POST / PUT / PATCH / DELETE 一定带 Origin：必须和本站一致，否则拒绝。
 * 没有 Origin 的请求不是浏览器发的（脚本、curl），也带不上受害者的 Cookie 被利用，只在 Sec-Fetch-Site 明确跨站时拒绝。
 */
export type OriginInput = {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  trustProxy: boolean;
  /** APP_URL / URL：站点对外地址 */
  siteUrls: (string | undefined)[];
};

function hostOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function originAllowed(i: OriginInput): boolean {
  if (i.origin === null) return i.secFetchSite !== "cross-site";
  const from = hostOf(i.origin); // Origin: null（沙箱 iframe 等）解析不出，直接拒绝
  if (!from) return false;
  const hosts = new Set<string>();
  if (i.host) hosts.add(i.host.toLowerCase());
  // 只有声明了前面有可信代理才看 X-Forwarded-Host，否则客户端可以自己伪造
  if (i.trustProxy && i.forwardedHost) hosts.add(i.forwardedHost.split(",")[0].trim().toLowerCase());
  for (const u of i.siteUrls) {
    const h = hostOf(u);
    if (h) hosts.add(h);
  }
  return hosts.has(from);
}
