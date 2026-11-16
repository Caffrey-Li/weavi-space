/** 只对专门创建的空 T9 测试库运行；先执行 prisma migrate deploy。 */
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { bugWhere, requirementWhere } from "@/lib/access";
import { revokeUserSessions } from "@/lib/auth";
import { API_TOKEN_LIMIT, authenticateApiToken, authorizeApiToken, createApiToken, revokeApiToken } from "@pm-collab/core/api-tokens";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.username !== "pm_test" || !/^\/pm_collab_t9_token_test_[a-f0-9]+$/.test(url.pathname)) {
  throw new Error("拒绝运行：只允许专门创建的本机 T9 令牌测试库");
}

async function main() {
  await prisma.organization.createMany({ data: [
    { id: "org_nova_collab", name: "Root", type: "system" },
    { id: "a", name: "A", type: "enterprise", parentId: "org_nova_collab" },
    { id: "b", name: "B", type: "enterprise", parentId: "org_nova_collab" },
  ] });
  await prisma.role.create({ data: { key: "token_self_test", name: "Self", dataScope: "self" } });
  const user = await prisma.user.create({ data: { email: "self@verify.test", name: "Self", globalRole: "token_self_test", orgId: "a", passwordHash: "synthetic", mustChangePassword: false } });
  const other = await prisma.user.create({ data: { email: "other@verify.test", name: "Other", orgId: "a" } });
  const outsider = await prisma.user.create({ data: { email: "outside@verify.test", name: "Outside", orgId: "b" } });
  const login = await prisma.session.create({ data: { userId: user.id, tokenHash: "synthetic-session", expiresAt: new Date(Date.now() + 3600_000) } });
  const session = { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole, sessionId: login.id };
  const project = await prisma.project.create({ data: { name: "A", key: "A", systemName: "A", enterpriseId: "a" } });
  const foreign = await prisma.project.create({ data: { name: "B", key: "B", systemName: "B", enterpriseId: "b" } });
  const visibleReq = await prisma.requirement.create({ data: { title: "Own", projectId: project.id, creatorId: user.id } });
  const hiddenReq = await prisma.requirement.create({ data: { title: "Other", projectId: project.id, creatorId: other.id } });
  const poolReq = await prisma.requirement.create({ data: { title: "Pool", creatorId: user.id } });
  const foreignReq = await prisma.requirement.create({ data: { title: "Foreign", projectId: foreign.id, creatorId: user.id } });
  const visibleBug = await prisma.bug.create({ data: { title: "Own", projectId: project.id, creatorId: user.id } });
  const hiddenBug = await prisma.bug.create({ data: { title: "Other", projectId: project.id, creatorId: other.id } });
  const poolBug = await prisma.bug.create({ data: { title: "Pool", creatorId: user.id } });
  await prisma.bug.create({ data: { title: "Foreign", projectId: foreign.id, creatorId: outsider.id, assigneeId: user.id } });

  const issue = () => createApiToken(session, { name: "test", scopes: ["projects.read", "requirements.read", "bugs.read"] });
  const request = (token: string) => new Request("http://localhost/api/v1/test", { headers: { authorization: `Bearer ${token}` } });
  const token = await issue();
  const auth = await authenticateApiToken(request(token.token));
  assert(auth.ok);
  assert.equal(await authorizeApiToken(auth.principal, "projects.read", project.id), null);
  assert.equal(await authorizeApiToken(auth.principal, "requirements.read", foreign.id), null);
  const scope = await authorizeApiToken(auth.principal, "requirements.read");
  assert(scope);
  const reqs = await prisma.requirement.findMany({ where: requirementWhere(scope.access), select: { id: true } });
  assert.deepEqual(new Set(reqs.map((r) => r.id)), new Set([visibleReq.id, poolReq.id]));
  assert(!reqs.some((r) => r.id === hiddenReq.id || r.id === foreignReq.id));
  const bugs = await prisma.bug.findMany({ where: bugWhere(scope.access), select: { id: true } });
  assert.deepEqual(new Set(bugs.map((b) => b.id)), new Set([visibleBug.id, poolBug.id]));
  assert(!bugs.some((b) => b.id === hiddenBug.id));
  console.log("✓ 项目、公共池和仅本人资源的真实数据库范围");

  assert(await revokeApiToken(session, token.id));
  assert.deepEqual(await authenticateApiToken(request(token.token)), { ok: false, status: 401 });
  const expired = await issue();
  await prisma.apiToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await authenticateApiToken(request(expired.token)), { ok: false, status: 401 });
  const deactivated = await issue();
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  assert.deepEqual(await authenticateApiToken(request(deactivated.token)), { ok: false, status: 401 });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  const changed = await issue();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: "changed-synthetic" } });
  assert.deepEqual(await authenticateApiToken(request(changed.token)), { ok: false, status: 401 });
  const profile = await issue();
  await prisma.user.update({ where: { id: user.id }, data: { name: "Renamed", avatarUrl: "/uploads/avatars/synthetic.png" } });
  assert((await authenticateApiToken(request(profile.token))).ok, "改姓名和头像不应使令牌失效");
  await prisma.user.update({ where: { id: user.id }, data: { orgId: "b" } });
  assert.deepEqual(await authenticateApiToken(request(profile.token)), { ok: false, status: 401 });
  await prisma.user.update({ where: { id: user.id }, data: { orgId: "a" } });
  const revoked = await issue();
  await revokeUserSessions(user.id);
  assert.deepEqual(await authenticateApiToken(request(revoked.token)), { ok: false, status: 401 });
  console.log("✓ 吊销、到期、停用、改密、调整组织和会话批量吊销；改资料不失效");

  const rateSession = await prisma.session.create({ data: { userId: user.id, tokenHash: "synthetic-rate-session", expiresAt: new Date(Date.now() + 3600_000) } });
  const rateToken = await createApiToken({ ...session, sessionId: rateSession.id }, { name: "rate", scopes: ["projects.read"] });
  const results = await Promise.all(Array.from({ length: API_TOKEN_LIMIT + 15 }, () => authenticateApiToken(request(rateToken.token))));
  assert.equal(results.filter((r) => r.ok).length, API_TOKEN_LIMIT);
  assert.equal(results.filter((r) => !r.ok && r.status === 429).length, 15);
  const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: rateToken.id }, select: { rateCount: true } });
  assert.equal(stored.rateCount, API_TOKEN_LIMIT);
  console.log(`✓ ${API_TOKEN_LIMIT + 15} 个并发请求：${API_TOKEN_LIMIT} 成功，15 限流`);
}

main().finally(() => prisma.$disconnect());
