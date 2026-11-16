import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@pm-collab/db/prisma";
import { authSecretString } from "../shared/auth-secret";

/**
 * 一次性令牌（login_tokens）：
 * - invite / reset：链接里带 32 字节随机令牌，库里只存 sha256；用一次作废，同一账号同类旧令牌在新建时作废；
 * - code：6 位验证码，库里只存 HMAC，10 分钟有效，最多试 5 次。
 */
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export const RESET_TTL_MS = 24 * 3600 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_RESEND_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeMac = (id: string, code: string) => createHmac("sha256", `${authSecretString()}:login-code:v1`).update(`${id}:${code}`).digest("hex");

export async function createLinkToken(userId: string, purpose: "invite" | "reset", createdById: string | null) {
  const raw = randomBytes(32).toString("base64url");
  const ttl = purpose === "invite" ? INVITE_TTL_MS : RESET_TTL_MS;
  await prisma.$transaction([
    prisma.loginToken.updateMany({ where: { userId, purpose: { in: ["invite", "reset"] }, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.loginToken.create({ data: { userId, purpose, tokenHash: sha(raw), expiresAt: new Date(Date.now() + ttl), createdById } }),
  ]);
  return raw;
}

/** 查看令牌（不消耗）：无效、过期、用过或试错太多次返回 null */
export async function peekLinkToken(raw: string) {
  if (!raw || raw.length > 100) return null;
  const t = await prisma.loginToken.findUnique({ where: { tokenHash: sha(raw) }, include: { user: true } });
  if (!t || t.usedAt || t.expiresAt < new Date() || t.attempts >= MAX_ATTEMPTS || !t.user.isActive) return null;
  if (t.purpose !== "invite" && t.purpose !== "reset") return null;
  return t;
}

export async function failLinkToken(id: string) {
  await prisma.loginToken.update({ where: { id }, data: { attempts: { increment: 1 } } });
}

/** 消耗令牌：并发下只有一个请求能成功 */
export async function consumeLinkToken(id: string) {
  const r = await prisma.loginToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return r.count === 1;
}

/** 生成验证码；距上次发送不到 60 秒返回 null */
export async function createCode(userId: string, channel: "email" | "sms") {
  const last = await prisma.loginToken.findFirst({ where: { userId, purpose: "code" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_MS) return null;
  await prisma.loginToken.updateMany({ where: { userId, purpose: "code", usedAt: null }, data: { usedAt: new Date() } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await prisma.loginToken.create({ data: { userId, purpose: "code", channel, expiresAt: new Date(Date.now() + CODE_TTL_MS), codeHash: "" } });
  await prisma.loginToken.update({ where: { id: row.id }, data: { codeHash: codeMac(row.id, code) } });
  return code;
}

/** 校验验证码：成功即作废；错 5 次作废 */
export async function verifyCode(userId: string, code: string) {
  const t = await prisma.loginToken.findFirst({ where: { userId, purpose: "code", usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!t || !t.codeHash || t.expiresAt < new Date() || t.attempts >= MAX_ATTEMPTS) return false;
  const a = Buffer.from(codeMac(t.id, String(code || "").trim()));
  const b = Buffer.from(t.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await prisma.loginToken.update({ where: { id: t.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  return (await prisma.loginToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } })).count === 1;
}
