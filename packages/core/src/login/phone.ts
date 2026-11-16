import { createHmac } from "crypto";
import { authSecretString } from "../shared/auth-secret";
import { openText, sealText } from "../shared/secure-config";

/**
 * 手机号：库里只存密文（phoneEnc）和 HMAC（phoneHash，按手机号查找、判重用），界面只显示脱敏值。
 * HMAC 密钥由 AUTH_SECRET 派生（AUTH_SECRET 不能改，否则旧手机号查不到）。
 */

/** 规范化：去掉空格、短横线和 +86 / 86 前缀；大陆手机号 11 位 1 开头，其他国家 +区号 6～15 位 */
export function normalizePhone(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s-()]/g, "");
  if (!s) return null;
  if (/^(\+?86)?1\d{10}$/.test(s)) return s.slice(-11);
  if (/^\+\d{6,15}$/.test(s)) return s;
  return null;
}

export function phoneHash(normalized: string) {
  return createHmac("sha256", `${authSecretString()}:phone:v1`).update(normalized).digest("hex");
}

export function sealPhone(normalized: string) {
  return { phoneEnc: sealText(normalized), phoneHash: phoneHash(normalized) };
}

export function openPhone(enc: string | null | undefined) {
  return openText(enc);
}

/** 138****1234；国际号码保留前 3 位和后 4 位 */
export function maskPhone(normalized: string | null | undefined) {
  if (!normalized) return "";
  if (normalized.length <= 7) return `${normalized.slice(0, 1)}***`;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}
