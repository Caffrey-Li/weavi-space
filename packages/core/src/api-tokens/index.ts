import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess } from "../access";
import { securityLog } from "../shared/security-log";
import { clientIp, hitIp } from "../shared/rate-limit";
import type { SessionUser } from "../auth";
import { API_SCOPES, isApiScope, isReadScope, type ApiScope } from "./scopes";
import { effectiveScopes, enterpriseOfOrg, readPolicy } from "./policy";

const TOKEN_PATTERN = /^nc_pat_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;
const WINDOW_MS = 60_000;
export const API_TOKEN_LIMIT = 120;
const EMPTY_HASH = Buffer.alloc(32);

const digest = (value: string) => createHash("sha256").update(value).digest();
type CredentialFields = { passwordHash: string | null; globalRole: string; orgId: string | null };
/**
 * 凭证指纹：只覆盖决定身份和数据范围的字段（密码、角色、所属组织）。存在 passwordFingerprint 列。
 * 不再比较 users.updatedAt：改姓名、头像、飞书登录都会刷新它，令牌会被无关操作作废。
 * 停用、改密、改角色、改邮箱另由 revokeUserSessions 主动吊销令牌；停用和强制改密在认证时也直接检查。
 */
const fingerprint = (user: CredentialFields) => digest(JSON.stringify(["v2", user.passwordHash ?? "no-password", user.globalRole, user.orgId ?? ""])).toString("hex");
const USER_FIELDS = { id: true, email: true, name: true, globalRole: true, avatarUrl: true, isActive: true, mustChangePassword: true, passwordHash: true, orgId: true, updatedAt: true } as const;

/** 接收已由 Cookie 会话认证的当前用户；令牌本身不得签发或吊销令牌。 */
async function activeSession(session: SessionUser, db: Pick<Prisma.TransactionClient, "session"> = prisma) {
  if (!session.sessionId || session.apiTokenScopes) throw new Error("需要有效的登录会话");
  const row = await db.session.findUnique({
    where: { id: session.sessionId },
    select: {
      userId: true, revokedAt: true, expiresAt: true,
      user: { select: USER_FIELDS },
    },
  });
  if (!row || row.userId !== session.id || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.user.isActive || (row.user.mustChangePassword && row.user.passwordHash)) {
    throw new Error("需要有效的登录会话");
  }
  return row.user;
}

/** 明文仅由此方法返回，不保存；调用方不得记录或再次展示。 */
export async function createApiToken(session: SessionUser, input: { name: string; scopes: string[]; expiresAt?: Date | null }) {
  if (session.isDemo || session.demoKind) throw new Error("体验账号不能创建 API 令牌");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("令牌名称需为 1–80 个字符");
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.some((scope) => typeof scope !== "string" || !isApiScope(scope))) throw new Error("令牌权限范围无效");
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new Error("到期时间无效");
  const user = await activeSession(session);
  const scopes = Array.from(new Set(input.scopes)) as ApiScope[];
  // T34：企业的数据开放策略
  const policy = await readPolicy(await enterpriseOfOrg(user.orgId), true);
  if (!policy.allowTokens) throw new Error("你所在的企业已关闭个人 API 令牌（MCP / 开放接口），请联系企业管理员");
  const over = scopes.filter((s) => !policy.scopes.includes(s));
  if (over.length) throw new Error(`企业不允许令牌获取这些范围：${over.join("、")}`);
  for (const scope of scopes) {
    if (!isReadScope(scope) && !(await can(user, scope))) throw new Error("令牌权限不能超过账号权限");
  }
  const lookupId = randomBytes(8).toString("hex");
  const token = `nc_pat_${lookupId}_${randomBytes(32).toString("base64url")}`;
  const record = await prisma.$transaction(async (tx) => {
    // 与会话吊销串行化，避免校验后、写入前发生吊销却仍签发有效令牌。
    await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${session.sessionId} FOR UPDATE`;
    const current = await activeSession(session, tx);
    if (fingerprint(current) !== fingerprint(user)) throw new Error("账号已发生变化，请重试");
    return tx.apiToken.create({
      data: {
        userId: user.id, lookupId, tokenHash: digest(token).toString("hex"), tokenHint: token.slice(-4), name, scopes,
        userVersion: user.updatedAt, passwordFingerprint: fingerprint(user), expiresAt,
      },
      select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true },
    });
  });
  return { ...record, token };
}

/** 仅允许当前用户吊销自己的令牌；幂等且不暴露其他用户的令牌。 */
export async function revokeApiToken(session: SessionUser, id: string) {
  const user = await activeSession(session);
  const result = await prisma.apiToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count > 0;
}

type TokenUser = SessionUser & { apiTokenScopes: readonly ApiScope[] };
/** enterpriseId：令牌所属账号的企业（调用记录用；不属于企业为 ""） */
export type ApiTokenPrincipal = { tokenId: string; user: TokenUser; enterpriseId?: string };
type AuthResult = { ok: true; principal: ApiTokenPrincipal } | { ok: false; status: 401 | 429 };

async function invalid(req: Request): Promise<AuthResult> {
  const ip = clientIp(req.headers);
  // 无可信来源时使用共享桶，避免无来源的无效令牌完全不受限。
  const retry = hitIp(ip === "unknown" ? "unknown-source" : ip, "api-token-invalid");
  await securityLog("api_token_invalid", "-", ip);
  return { ok: false, status: retry ? 429 : 401 };
}

/** 只读取 v1 请求的 Authorization，绝不读取 URL 或 Cookie 中的令牌。 */
export async function authenticateApiToken(req: Request): Promise<AuthResult> {
  const path = new URL(req.url).pathname;
  // 只在开放接口 v1 和 MCP 上认令牌
  if (path !== "/api/v1" && !path.startsWith("/api/v1/") && path !== "/api/mcp") return invalid(req);
  const auth = req.headers.get("authorization") || "";
  if (auth.length > 128) return invalid(req);
  const match = /^Bearer (\S+)$/i.exec(auth);
  const token = match?.[1] || "";
  const parts = TOKEN_PATTERN.exec(token);
  if (!parts) return invalid(req);
  const row = await prisma.apiToken.findUnique({
    where: { lookupId: parts[1] },
    select: {
      id: true, tokenHash: true, passwordFingerprint: true, scopes: true, revokedAt: true, expiresAt: true,
      user: { select: USER_FIELDS },
    },
  });
  const validHash = !!row && /^[a-f0-9]{64}$/.test(row.tokenHash);
  const expected = validHash ? Buffer.from(row.tokenHash, "hex") : EMPTY_HASH;
  const matches = timingSafeEqual(digest(token), expected);
  const now = new Date();
  if (!row || !validHash || !matches || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) || !row.user.isActive ||
      (row.user.mustChangePassword && row.user.passwordHash) ||
      row.passwordFingerprint !== fingerprint(row.user) || !row.scopes.length || row.scopes.some((scope) => !isApiScope(scope))) return invalid(req);

  // 两个条件更新均由数据库原子执行：跨进程同一令牌共享固定窗口。
  const valid = {
    id: row.id, revokedAt: null, passwordFingerprint: row.passwordFingerprint,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    user: { is: { isActive: true, passwordHash: row.user.passwordHash, mustChangePassword: row.user.mustChangePassword, globalRole: row.user.globalRole, orgId: row.user.orgId } },
  };
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const reset = await prisma.apiToken.updateMany({
    where: { AND: [valid, { OR: [{ rateWindowAt: null }, { rateWindowAt: { lte: cutoff } }] }] },
    data: { rateWindowAt: now, rateCount: 1, lastUsedAt: now },
  });
  if (!reset.count) {
    const count = await prisma.apiToken.updateMany({
      where: { AND: [valid, { rateWindowAt: { gt: cutoff }, rateCount: { lt: API_TOKEN_LIMIT } }] },
      data: { rateCount: { increment: 1 }, lastUsedAt: now },
    });
    if (!count.count) {
      const stillValid = await prisma.apiToken.findFirst({ where: valid, select: { id: true } });
      if (!stillValid) return invalid(req);
      await securityLog("api_token_rate_limited", "-", "unknown");
      return { ok: false, status: 429 };
    }
  }
  const { user } = row;
  // T34：按企业策略收窄；企业关闭令牌或范围全被收回时按令牌失效处理
  const enterpriseId = await enterpriseOfOrg(user.orgId);
  const scopes = effectiveScopes(row.scopes, await readPolicy(enterpriseId));
  if (!scopes.length) {
    await securityLog("api_token_policy_denied", "-", "unknown", user.id);
    return { ok: false, status: 401 };
  }
  return { ok: true, principal: { tokenId: row.id, enterpriseId, user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole, avatarUrl: user.avatarUrl, apiTokenScopes: scopes } } };
}

/** projectId 表示授权访问项目本身；公共池和仅本人资源应省略它并使用返回的数据范围。 */
export async function authorizeApiToken(principal: ApiTokenPrincipal, scope: ApiScope, projectId?: string | null) {
  if (!(API_SCOPES as readonly string[]).includes(scope) || !(await can(principal.user, scope, projectId))) return null;
  const access = await getAccess(principal.user);
  if (projectId && access.tenantIds !== null && !access.tenantIds.includes(projectId)) return null;
  return { user: principal.user, access };
}

/** 列表里显示的令牌：前缀 + 查找 id 前 4 位 + 脱敏 + 末尾 4 位（旧令牌没存末尾就显示 ····） */
export function maskedToken(lookupId: string, hint: string | null) {
  return `nc_pat_${lookupId.slice(0, 4)}••••••••${hint || "····"}`;
}
