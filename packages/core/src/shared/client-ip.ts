/**
 * Netlify 上取客户端 IP（实测 11-05）：
 * - 函数层的 x-nf-client-connection-ip 是平台内部一跳的地址，X-Forwarded-For 也多了内部地址；
 * - 只有边缘层（proxy）的 X-Forwarded-For 最后一项是真实来源。
 * 所以 proxy 在边缘取出来写进内部头，函数只读这个头。proxy 每次都先删再写，客户端传来的值无效。
 * 这个文件要保持纯函数：proxy 在 Netlify 上不能引 Prisma。
 */
export const CLIENT_IP_HEADER = "x-pm-client-ip";

/** 部署在 Netlify 时设 TRUST_NETLIFY_IP=1（函数运行时没有 NETLIFY 变量，只能显式声明） */
export const trustNetlifyIp = () => process.env.TRUST_NETLIFY_IP === "1";

export function edgeClientIp(headers: Headers): string | null {
  const list = (headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] || null;
}
