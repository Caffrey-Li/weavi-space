import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../system/result";
import { managedEnterprise } from "../ai/credentials";
import { SYSTEM_ORG_ID, level2OrgId, listOrgs, subtreeIds } from "../shared/org";
import { maskedToken } from "./index";
import { effectiveScopes, readPolicy, savePolicy } from "./policy";
import { API_SCOPES, READ_SCOPES, SCOPE_LABEL, WRITE_SCOPES, isApiScope } from "./scopes";

/**
 * T34「系统 › 数据开放」：企业超管管本企业，系统超管管全部企业和不属于企业的账号（scope = ""）。
 * 能做的：开关成员的个人 API 令牌、限定令牌最多能拿的范围、查看成员的令牌和调用记录、吊销成员令牌。
 */
async function scopes(session: SessionUser) {
  const ent = await managedEnterprise(session, null);
  if (session.globalRole === "admin") return [{ id: "", name: "Weavi Space 系统（不属于企业的账号）" }, ...ent.list];
  return ent.list;
}

/** 这个范围里的账号 id */
async function memberIds(scope: string) {
  const orgs = await listOrgs();
  if (scope) {
    const users = await prisma.user.findMany({ where: { orgId: { in: subtreeIds(orgs, scope) } }, select: { id: true } });
    return users.map((u) => u.id);
  }
  const users = await prisma.user.findMany({ select: { id: true, orgId: true } });
  return users.filter((u) => !level2OrgId(orgs, u.orgId || SYSTEM_ORG_ID)).map((u) => u.id);
}

async function pick(session: SessionUser, raw: unknown) {
  const list = await scopes(session);
  if (!list.length) return null;
  const want = raw === null || raw === undefined ? null : String(raw);
  const scope = want !== null && list.some((s) => s.id === want) ? want : list[0].id;
  return { list, scope };
}

const PAGE = 30;

export async function GET(session: SessionUser, q: { scope?: string | null; userId?: string | null; page?: string | null }) {
  const p = await pick(session, q.scope);
  if (!p) return result({ error: "只有系统超管和企业超管可以管理数据开放" }, { status: 403 });
  const ids = await memberIds(p.scope);
  const policy = await readPolicy(p.scope, true);
  const userId = q.userId && ids.includes(q.userId) ? q.userId : null;
  const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
  const since = new Date(Date.now() - 7 * 864e5);
  const logWhere = { enterpriseId: p.scope, ...(userId ? { userId } : {}) };
  const [tokens, logs, total, week, users] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId: { in: ids }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true, lookupId: true, tokenHint: true, userId: true, connection: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.apiAccessLog.findMany({ where: logWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.apiAccessLog.count({ where: logWhere }),
    prisma.apiAccessLog.groupBy({ by: ["userId"], where: { enterpriseId: p.scope, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  return result({
    scopes: p.list,
    scope: p.scope,
    policy,
    allScopes: { read: READ_SCOPES, write: WRITE_SCOPES, labels: SCOPE_LABEL },
    members: users.sort((a, b) => a.name.localeCompare(b.name, "zh")).map((u) => ({ id: u.id, name: u.name })),
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      userId: t.userId,
      userName: name.get(t.userId) || "—",
      scopes: t.scopes,
      effective: effectiveScopes(t.scopes, policy),
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() || null,
      lastUsedAt: t.lastUsedAt?.toISOString() || null,
      masked: maskedToken(t.lookupId, t.tokenHint),
      agent: Boolean(t.connection),
    })),
    logs: logs.map((l) => ({ id: l.id, at: l.createdAt.toISOString(), userName: name.get(l.userId) || "—", channel: l.channel, action: l.action, status: l.status })),
    logTotal: total,
    page,
    pageSize: PAGE,
    filterUserId: userId,
    week: week.map((w) => ({ userId: w.userId, name: name.get(w.userId) || "—", count: w._count._all })).sort((a, b) => b.count - a.count),
  });
}

export async function PUT(session: SessionUser, body: Record<string, unknown>) {
  const p = await pick(session, body.scope);
  if (!p) return result({ error: "只有系统超管和企业超管可以管理数据开放" }, { status: 403 });
  if (body.scope !== undefined && String(body.scope) !== p.scope) return result({ error: "没有这个范围的管理权限" }, { status: 403 });
  const scopesIn = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
  if (scopesIn.some((s) => !isApiScope(s))) return result({ error: "权限范围无效" }, { status: 400 });
  const allowTokens = body.allowTokens !== false;
  if (allowTokens && !scopesIn.length) return result({ error: "允许令牌时至少保留一项范围；要全部禁止请关闭「允许成员使用 API 令牌」" }, { status: 400 });
  const policy = await savePolicy(p.scope, { allowTokens, scopes: scopesIn.filter(isApiScope) }, session.id);
  await prisma.activityLog.create({ data: { entityType: "api_policy", entityId: p.scope || "system", action: "updated", actorId: session.id, toValue: JSON.stringify(policy) } });
  return result({ ok: true, policy, allScopes: API_SCOPES });
}

/** 吊销成员令牌：令牌所属账号必须在这个管理范围里 */
export async function revokeMemberToken(session: SessionUser, scopeRaw: unknown, tokenId: string) {
  const p = await pick(session, scopeRaw);
  if (!p) return result({ error: "只有系统超管和企业超管可以管理数据开放" }, { status: 403 });
  const ids = await memberIds(p.scope);
  const t = await prisma.apiToken.findFirst({ where: { id: tokenId, userId: { in: ids }, revokedAt: null }, select: { id: true, userId: true, name: true } });
  if (!t) return result({ error: "令牌不存在" }, { status: 404 });
  await prisma.apiToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
  await prisma.activityLog.create({ data: { entityType: "api_token", entityId: t.id, action: "revoked_by_admin", actorId: session.id, message: `吊销了成员令牌「${t.name}」`, toValue: JSON.stringify({ userId: t.userId }) } });
  return result({ ok: true });
}
