import { cache } from "react";
import { createHash, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@pm-collab/db/prisma";
import { allowedWhileForcedChange } from "./shared/force-change";
import { clientIp } from "./shared/rate-limit";

const COOKIE = "pm_session";
const BCRYPT_COST = 12;
const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;
/** lastSeenAt 最多每 5 分钟写一次，避免每个请求都写库 */
const TOUCH_MS = 5 * 60 * 1000;

/** 演示访客唯一允许的写请求 */
const DEMO_WRITE_ALLOWED = ["/api/auth/logout"];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  globalRole: string;
  avatarUrl?: string | null;
  mustChangePassword?: boolean;
  /** 当前会话的 id（只有 getSession 返回的才有） */
  sessionId?: string;
  /** 演示站访客体验账号：只读 */
  isDemo?: boolean;
  /** API 令牌只能使用显式授予的 scope；Cookie 会话不设置此字段。 */
  apiTokenScopes?: readonly string[];
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** 登录成功后调用：建一条会话并写 Cookie。Cookie 里只有随机令牌，身份和权限全部以数据库为准 */
export async function startSession(userId: string, remember = true) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: h.get("user-agent")?.slice(0, 300) || null,
      ip: clientIp(h),
      expiresAt: new Date(now + (remember ? REMEMBER_MS : SHORT_MS)),
    },
  });
  // 顺手清掉过期一天以上的记录
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } }).catch(() => undefined);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await cookieSecure(),
    maxAge: remember ? REMEMBER_MS / 1000 : undefined,
  });
}

/** 吊销某个用户的全部会话（改密、停用、改角色、重置密码时调用）；exceptId 为要保留的会话 */
export async function revokeUserSessions(userId: string | string[], exceptId?: string) {
  const users = Array.isArray(userId) ? { in: userId } : userId;
  const revokedAt = new Date();
  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId: users, revokedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      data: { revokedAt },
    }),
    prisma.apiToken.updateMany({ where: { userId: users, revokedAt: null }, data: { revokedAt } }),
  ]);
}

/** 登出：吊销当前会话并清 Cookie */
export async function endCurrentSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(COOKIE);
}

/** 只清 Cookie（令牌已失效时用） */
export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

/**
 * Cookie 是否带 Secure：COOKIE_SECURE 显式设了就听它的；
 * 没设时，生产环境默认带 Secure，只有本机（localhost / 127.0.0.1）的 http 访问例外，方便本地 npm start。
 */
export async function cookieSecure() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.NODE_ENV !== "production") return false;
  const h = await headers();
  const host = (h.get("host") || "").replace(/:\d+$/, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return !(local && h.get("x-forwarded-proto") !== "https");
}

/** 当前请求内只查一次；身份、角色、停用、强制改密都实时读库 */
const loadSession = cache(async (token: string) => {
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, globalRole: true, avatarUrl: true, isActive: true, mustChangePassword: true, passwordHash: true, isDemo: true } },
    },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.user.isActive) return null;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_MS) {
    await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return row;
});

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await loadSession(token);
  if (!row) return null;
  const { user } = row;
  // 被要求改密，或接受邀请 / 被重置后还没有密码（这时设置密码不需要当前密码）
  const mustChangePassword = user.mustChangePassword;
  if (mustChangePassword) {
    // x-pm-path 由中间件写入并覆盖客户端传来的值。接口返回未登录，页面（含前端路由切换）跳到改密页
    const path = (await headers()).get("x-pm-path") || "";
    if (!allowedWhileForcedChange(path)) {
      if (!path || path.startsWith("/api/")) return null;
      redirect("/settings?force=1");
    }
  }
  if (user.isDemo) {
    // 演示访客只读：除退出登录外，所有写请求都当作未登录处理（页面和 GET 接口照常）
    const h = await headers();
    const method = (h.get("x-pm-method") || "GET").toUpperCase();
    const path = h.get("x-pm-path") || "";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !DEMO_WRITE_ALLOWED.includes(path)) return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    avatarUrl: user.avatarUrl || null,
    mustChangePassword,
    sessionId: row.id,
    isDemo: user.isDemo,
  };
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ||= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST));

export async function authenticate(account: string, password: string) {
  const trimmed = String(account || "").trim();
  if (!trimmed) return null;
  // Exact match first, then lower-case (compat with legacy email accounts)
  let user = await prisma.user.findUnique({ where: { email: trimmed } });
  if (!user) {
    const lower = trimmed.toLowerCase();
    if (lower !== trimmed) {
      user = await prisma.user.findUnique({ where: { email: lower } });
    }
  }
  if (!user) {
    // Case-insensitive fallback for non-email accounts
    const lower = trimmed.toLowerCase();
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE lower(email) = ${lower} LIMIT 1
    `;
    if (rows[0]?.id) {
      user = await prisma.user.findUnique({ where: { id: rows[0].id } });
    }
  }
  // 账号不存在也做一次同样耗时的比对，防止靠响应时间枚举账号
  const ok = await verifyPassword(password, user?.passwordHash || (await dummyHash()));
  if (!ok || !user || !user.isActive || !user.passwordHash) return null;
  // 旧哈希强度不够：登录成功时顺便升级
  if (bcrypt.getRounds(user.passwordHash) < BCRYPT_COST) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }).catch(() => undefined);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    avatarUrl: user.avatarUrl,
    mustChangePassword: user.mustChangePassword,
  } satisfies SessionUser;
}
