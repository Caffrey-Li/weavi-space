import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@pm-collab/db/prisma";
import { authSecretString } from "../shared/auth-secret";
import { INVITE_CODE_ALPHABET } from "../shared/unbound-account";

/**
 * 一次性令牌（login_tokens）：
 * - invite / reset：链接里带 32 字节随机令牌，库里只存 sha256；用一次作废，同一账号同类旧令牌在新建时作废；
 * - invite 也可以是 8 位邀请码（createInviteCode），同样只存 sha256；
 * - code：6 位验证码，库里只存 HMAC，10 分钟有效，最多试 5 次；bind：绑定邮箱 / 手机号的验证码，HMAC 里带地址。
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

/**
 * 邀请码（11-21）：8 位，库里只存 sha256（和链接令牌同一列），7 天有效、用一次作废；
 * 同一账号旧的邀请 / 重置令牌作废。撞上已有哈希（概率极低）就重新生成。
 */
export async function createInviteCode(userId: string, createdById: string | null) {
  for (let i = 0; i < 5; i++) {
    const code = Array.from({ length: 8 }, () => INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)]).join("");
    if (await prisma.loginToken.findUnique({ where: { tokenHash: sha(code) }, select: { id: true } })) continue;
    await prisma.$transaction([
      prisma.loginToken.updateMany({ where: { userId, purpose: { in: ["invite", "reset"] }, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.loginToken.create({ data: { userId, purpose: "invite", tokenHash: sha(code), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdById } }),
    ]);
    return code;
  }
  throw new Error("邀请码生成失败，请重试");
}

/** 绑定邮箱 / 手机号的验证码：HMAC 里带上要绑定的地址，换地址验证码就不对 */
const bindMac = (id: string, target: string, code: string) => createHmac("sha256", `${authSecretString()}:bind-code:v1`).update(`${id}:${target}:${code}`).digest("hex");

export async function createBindCode(userId: string, channel: "email" | "sms", target: string) {
  const last = await prisma.loginToken.findFirst({ where: { userId, purpose: "bind" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_MS) return null;
  await prisma.loginToken.updateMany({ where: { userId, purpose: "bind", usedAt: null }, data: { usedAt: new Date() } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await prisma.loginToken.create({ data: { userId, purpose: "bind", channel, expiresAt: new Date(Date.now() + CODE_TTL_MS), codeHash: "" } });
  await prisma.loginToken.update({ where: { id: row.id }, data: { codeHash: bindMac(row.id, target, code) } });
  return code;
}

export async function verifyBindCode(userId: string, channel: "email" | "sms", target: string, code: string) {
  const t = await prisma.loginToken.findFirst({ where: { userId, purpose: "bind", usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!t || !t.codeHash || t.channel !== channel || t.expiresAt < new Date() || t.attempts >= MAX_ATTEMPTS) return false;
  const a = Buffer.from(bindMac(t.id, target, String(code || "").trim()));
  const b = Buffer.from(t.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await prisma.loginToken.update({ where: { id: t.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  return (await prisma.loginToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } })).count === 1;
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
