import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  session: { findUnique: vi.fn() },
  apiToken: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  rolePermission: { findMany: vi.fn() },
  $transaction: vi.fn(), $queryRaw: vi.fn(),
} }));
vi.mock("@pm-collab/core/access", async (importOriginal) => ({ ...await importOriginal<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn(), canSeeProject: vi.fn() }));
vi.mock("@pm-collab/core/shared/security-log", () => ({ securityLog: vi.fn() }));
// T34 企业策略：这里按默认（允许、全部范围），策略本身在 t34-api-access.test.ts 测
vi.mock("@pm-collab/core/api-tokens/policy", async (importOriginal) => {
  const m = await importOriginal<typeof import("@pm-collab/core/api-tokens/policy")>();
  return { ...m, enterpriseOfOrg: vi.fn(async () => "a"), readPolicy: vi.fn(async () => m.DEFAULT_POLICY) };
});

import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { bugWhere, canSeeProject, getAccess, requirementWhere, type Access } from "@pm-collab/core/access";
import { securityLog } from "@pm-collab/core/shared/security-log";
import { readPolicy } from "@pm-collab/core/api-tokens/policy";
import { API_TOKEN_LIMIT, authenticateApiToken, authorizeApiToken, createApiToken, revokeApiToken } from "@pm-collab/core/api-tokens";

const clock = new Date("2026-11-06T12:00:00Z");
const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member", sessionId: "session" };
const user = { id: "u", email: "u@example.test", name: "U", globalRole: "member", avatarUrl: null, isActive: true, mustChangePassword: false, passwordHash: "synthetic-hash", orgId: "org-a" as string | null, updatedAt: new Date("2026-11-01T00:00:00Z") };
const access: Access = { userId: "u", scope: "involved", projectIds: ["mine"], tenantIds: ["mine"], enterpriseId: "a", orgIds: ["a"] };
const request = (token: string, path = "/api/v1/requirements") => new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}`, cookie: "pm_session=ignored" } });
let stored: Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(clock); vi.resetAllMocks();
  vi.mocked(prisma.session.findUnique).mockResolvedValue({ userId: "u", revokedAt: null, expiresAt: new Date("2027-01-01"), user } as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (action: (tx: typeof prisma) => unknown) => action(prisma)) as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "session" }] as never);
  vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([]);
  vi.mocked(getAccess).mockResolvedValue(access);
  vi.mocked(canSeeProject).mockResolvedValue(true);
  vi.mocked(prisma.apiToken.create).mockResolvedValue({ id: "token-id", name: "integration", scopes: [], createdAt: clock, expiresAt: new Date("2027-01-01") } as never);
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

async function issued(scopes = ["requirements.read", "requirements.edit"]) {
  const created = await createApiToken(session, { name: "integration", scopes, expiresAt: new Date("2027-01-01") });
  stored = vi.mocked(prisma.apiToken.create).mock.calls.at(-1)![0].data as unknown as Record<string, unknown>;
  const row = { ...stored, id: "token-id", revokedAt: null, user: { ...user } } as unknown as {
    id: string; revokedAt: Date | null; expiresAt: Date | null; scopes: string[]; user: typeof user;
  };
  vi.mocked(prisma.apiToken.findUnique).mockResolvedValue(row as never);
  return { created, row };
}

describe("API 令牌签发与失效", () => {
  it("只保存散列，明文仅在创建结果中返回", async () => {
    const { created } = await issued();
    expect(created.token.startsWith("nc_pat_")).toBe(true);
    expect(stored.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(JSON.stringify(stored).includes(created.token)).toBe(false);
    expect(stored.userId).toBe("u");
    expect(stored.scopes).toEqual(["requirements.read", "requirements.edit"]);
  });
  it("签发期间会话被吊销时拒绝创建", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValueOnce({ userId: "u", revokedAt: null, expiresAt: new Date("2027-01-01"), user } as never)
      .mockResolvedValueOnce({ userId: "u", revokedAt: clock, expiresAt: new Date("2027-01-01"), user } as never);
    await expect(createApiToken(session, { name: "x", scopes: ["requirements.read"] })).rejects.toThrow();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("不允许使用令牌身份签发或吊销令牌", async () => {
    const tokenSession = { ...session, apiTokenScopes: ["requirements.read"] };
    await expect(createApiToken(tokenSession, { name: "x", scopes: ["requirements.read"] })).rejects.toThrow();
    await expect(revokeApiToken(tokenSession, "token-id")).rejects.toThrow();
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("scope 不合法或超过用户的功能权限时不创建", async () => {
    await expect(createApiToken(session, { name: "x", scopes: ["users.manage"] })).rejects.toThrow();
    // docs.edit 自 T24 第三期起开放（需求交付在本机执行测试，MCP 回传结果用）
    for (const unused of ["project.edit", "bugs.delete", "releases.manage", "products.manage"]) {
      await expect(createApiToken(session, { name: "x", scopes: [unused] })).rejects.toThrow("令牌权限范围无效");
    }
    const guest = { ...user, globalRole: "guest" };
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ userId: "u", revokedAt: null, expiresAt: new Date("2027-01-01"), user: guest } as never);
    await expect(createApiToken(session, { name: "x", scopes: ["bugs.edit"] })).rejects.toThrow();
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("吊销只修改当前用户的令牌", async () => {
    expect(await revokeApiToken(session, "token-id")).toBe(true);
    expect(prisma.apiToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "token-id", userId: "u", revokedAt: null } }));
  });
  it.each(["expired", "revoked", "inactive", "password", "role", "org", "org-cleared", "forced-change", "unknown-scope"])("%s 时拒绝令牌并记录安全事件", async (reason) => {
    const { created, row } = await issued();
    if (reason === "expired") row.expiresAt = new Date(clock);
    if (reason === "revoked") row.revokedAt = clock;
    if (reason === "inactive") row.user.isActive = false;
    if (reason === "password") row.user.passwordHash = "changed-synthetic-hash";
    if (reason === "role") row.user.globalRole = "admin";
    if (reason === "org") row.user.orgId = "org-b";
    if (reason === "org-cleared") row.user.orgId = null;
    if (reason === "forced-change") row.user.mustChangePassword = true;
    if (reason === "unknown-scope") row.scopes = ["users.manage"];
    expect(await authenticateApiToken(request(created.token))).toEqual({ ok: false, status: 401 });
    expect(securityLog).toHaveBeenCalledWith("api_token_invalid", "-", "unknown");
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(securityLog).mock.calls).includes(created.token)).toBe(false);
  });
});

describe("无关资料变化不使令牌失效", () => {
  it("改姓名、头像或飞书登录刷新 updatedAt 后令牌仍然有效", async () => {
    const { created, row } = await issued();
    row.user.updatedAt = new Date(clock);
    row.user.name = "新名字";
    row.user.avatarUrl = "/uploads/avatars/new.png" as never;
    expect((await authenticateApiToken(request(created.token))).ok).toBe(true);
    const where = vi.mocked(prisma.apiToken.updateMany).mock.calls[0][0]!.where as { AND: [{ user: { is: Record<string, unknown> } }] };
    expect(where.AND[0].user.is).not.toHaveProperty("updatedAt");
    expect(where.AND[0].user.is).toMatchObject({ globalRole: "member", orgId: "org-a", passwordHash: "synthetic-hash" });
  });
});

describe("无效令牌来源限流", () => {
  it("格式错误或不存在的令牌不更新令牌行，超限返回 429", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const bad = () => new Request("http://localhost/api/v1/me", { headers: { authorization: "Bearer invalid", "x-forwarded-for": "203.0.113.97" } });
    for (let i = 0; i < 60; i++) expect((await authenticateApiToken(bad())).ok).toBe(false);
    expect(await authenticateApiToken(bad())).toEqual({ ok: false, status: 429 });
    expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
    expect(securityLog).toHaveBeenCalledWith("api_token_invalid", "-", "203.0.113.97");
    vi.unstubAllEnvs();
  });
  it("格式正确但不存在的令牌不会更新任何令牌行", async () => {
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue(null);
    const absent = `nc_pat_${"0".repeat(16)}_${"A".repeat(43)}`;
    expect(await authenticateApiToken(request(absent))).toEqual({ ok: false, status: 401 });
    expect(prisma.apiToken.findUnique).toHaveBeenCalledOnce();
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
    expect(securityLog).toHaveBeenCalled();
  });
});

describe("令牌认证、权限和限流", () => {
  it("只接受 v1 的 Authorization Bearer，不接收 URL 或 Cookie", async () => {
    const { created } = await issued(["requirements.read"]);
    expect((await authenticateApiToken(request(created.token))).ok).toBe(true);
    expect(await authenticateApiToken(request(created.token, "/api/requirements"))).toEqual({ ok: false, status: 401 });
    const query = new Request(`http://localhost/api/v1/requirements?token=${encodeURIComponent(created.token)}`, { headers: { cookie: `token=${created.token}` } });
    expect(await authenticateApiToken(query)).toEqual({ ok: false, status: 401 });
  });
  it("错误的认证方案不能替代 Bearer", async () => {
    const { created } = await issued();
    for (const authorization of [`Basic ${created.token}`, created.token, `Bearer ${created.token} extra`]) {
      const req = new Request("http://localhost/api/v1/requirements", { headers: { authorization } });
      expect(await authenticateApiToken(req)).toEqual({ ok: false, status: 401 });
    }
    expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
  });
  it("错误令牌不泄露明文到日志", async () => {
    const { created } = await issued();
    const wrong = `${created.token.slice(0, -1)}${created.token.endsWith("A") ? "B" : "A"}`;
    expect(await authenticateApiToken(request(wrong))).toEqual({ ok: false, status: 401 });
    expect(JSON.stringify(vi.mocked(securityLog).mock.calls).includes(wrong)).toBe(false);
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });
  it("管理员令牌也受 scope 限制", async () => {
    // 签发时就是管理员（签发后改角色会改变凭证指纹，令牌失效，见上方 role 用例）
    const admin = { ...user, globalRole: "admin" };
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ userId: "u", revokedAt: null, expiresAt: new Date("2027-01-01"), user: admin } as never);
    const { created, row } = await issued(["requirements.read"]);
    row.user = { ...admin };
    const auth = await authenticateApiToken(request(created.token));
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(await can(auth.principal.user, "bugs.edit")).toBe(false);
    expect(await authorizeApiToken(auth.principal, "bugs.edit")).toBeNull();
    expect(await can(auth.principal.user, "requirements.read")).toBe(true);
  });
  it("scope 与现有功能权限和企业数据范围取交集", async () => {
    const { created } = await issued();
    const auth = await authenticateApiToken(request(created.token));
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const context = await authorizeApiToken(auth.principal, "requirements.read");
    expect(context).not.toBeNull();
    expect(requirementWhere(context!.access)).toEqual({ OR: [{ projectId: { in: ["mine"] } }, { projectId: null, OR: [{ creatorId: "u" }, { creator: { orgId: { in: ["a"] } } }] }] });
    expect(await authorizeApiToken(auth.principal, "requirements.read", "other-enterprise-project")).toBeNull();
    vi.mocked(canSeeProject).mockResolvedValue(false);
    expect(await authorizeApiToken(auth.principal, "requirements.edit", "other-enterprise-project")).toBeNull();
  });
  it("读取指定项目时拒绝同企业不可见项目和跨企业项目", async () => {
    const { created } = await issued(["projects.read", "requirements.read"]);
    const auth = await authenticateApiToken(request(created.token));
    if (!auth.ok) throw new Error("令牌认证失败");
    vi.mocked(getAccess).mockResolvedValue({ ...access, tenantIds: ["mine", "same-enterprise"] });
    vi.mocked(canSeeProject).mockImplementation(async (_user, id) => id === "mine");
    for (const scope of ["projects.read", "requirements.read"] as const) {
      expect(await authorizeApiToken(auth.principal, scope, "mine")).not.toBeNull();
      expect(await authorizeApiToken(auth.principal, scope, "same-enterprise")).toBeNull();
      expect(await authorizeApiToken(auth.principal, scope, "other-enterprise")).toBeNull();
      expect(await can(auth.principal.user, scope, "same-enterprise")).toBe(false);
    }
  });
  it("公共池和仅本人资源按各自数据范围过滤，不要求项目成员资格", async () => {
    const { created } = await issued(["requirements.read", "bugs.read"]);
    const auth = await authenticateApiToken(request(created.token));
    if (!auth.ok) throw new Error("令牌认证失败");
    vi.mocked(getAccess).mockResolvedValue({ ...access, scope: "self", tenantIds: ["mine", "same-enterprise"] });
    vi.mocked(canSeeProject).mockResolvedValue(false);
    const reqAccess = await authorizeApiToken(auth.principal, "requirements.read");
    const bugAccess = await authorizeApiToken(auth.principal, "bugs.read");
    expect(reqAccess).not.toBeNull();
    expect(bugAccess).not.toBeNull();
    const tenant = { OR: [{ projectId: { in: ["mine", "same-enterprise"] } }, { projectId: null, OR: [{ creatorId: "u" }, { creator: { orgId: { in: ["a"] } } }] }] };
    expect(requirementWhere(reqAccess!.access)).toEqual({ AND: [tenant, { OR: [{ creatorId: "u" }, { assignees: { some: { userId: "u" } } }] }] });
    expect(bugWhere(bugAccess!.access)).toEqual({ AND: [tenant, { OR: [{ creatorId: "u" }, { assigneeId: "u" }, { frontendId: "u" }, { backendId: "u" }] }] });
    expect(canSeeProject).not.toHaveBeenCalled();
  });
  it("限流使用令牌自身原子计数，超限返回 429", async () => {
    const { created } = await issued();
    vi.mocked(prisma.apiToken.updateMany).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.apiToken.findFirst).mockResolvedValue({ id: "token-id" } as never);
    expect(await authenticateApiToken(request(created.token))).toEqual({ ok: false, status: 429 });
    const calls = vi.mocked(prisma.apiToken.updateMany).mock.calls;
    expect(calls[1][0].where).toMatchObject({ AND: [expect.objectContaining({ id: "token-id", revokedAt: null }), expect.objectContaining({ rateCount: { lt: API_TOKEN_LIMIT } })] });
    expect(securityLog).toHaveBeenCalledWith("api_token_rate_limited", "-", "unknown");
  });
  it("认证期间发生吊销时拒绝访问而非计作限流", async () => {
    const { created } = await issued();
    vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.apiToken.findFirst).mockResolvedValue(null);
    expect(await authenticateApiToken(request(created.token))).toEqual({ ok: false, status: 401 });
  });
});

describe("T34 企业数据开放策略", () => {
  it("企业关闭令牌时不能新建", async () => {
    vi.mocked(readPolicy).mockResolvedValue({ allowTokens: false, scopes: [] });
    await expect(createApiToken(session, { name: "x", scopes: ["requirements.read"] })).rejects.toThrow("已关闭");
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("超出企业允许范围的不能签发", async () => {
    vi.mocked(readPolicy).mockResolvedValue({ allowTokens: true, scopes: ["requirements.read"] });
    await expect(createApiToken(session, { name: "x", scopes: ["requirements.read", "bugs.read"] })).rejects.toThrow("bugs.read");
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("已有令牌按交集生效，企业收回全部范围后按失效处理", async () => {
    const { created } = await issued(["requirements.read", "bugs.read"]);
    vi.mocked(readPolicy).mockResolvedValue({ allowTokens: true, scopes: ["requirements.read", "docs.read"] });
    const ok = await authenticateApiToken(request(created.token));
    expect(ok.ok && ok.principal.user.apiTokenScopes).toEqual(["requirements.read"]);
    expect(ok.ok && ok.principal.enterpriseId).toBe("a");
    vi.mocked(readPolicy).mockResolvedValue({ allowTokens: false, scopes: ["requirements.read"] });
    const denied = await authenticateApiToken(request(created.token));
    expect(denied).toEqual({ ok: false, status: 401 });
    expect(securityLog).toHaveBeenCalledWith("api_token_policy_denied", "-", "unknown", "u");
  });
});
