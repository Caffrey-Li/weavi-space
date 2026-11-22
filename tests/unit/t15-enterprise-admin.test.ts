import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    project: { groupBy: vi.fn() },
    activityLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@pm-collab/core/auth", () => ({ hashPassword: vi.fn(async () => "hashed"), revokeUserSessions: vi.fn(), getSession: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/login/links", () => ({ issueInvite: vi.fn(), issueReset: vi.fn() }));
vi.mock("@pm-collab/core/shared/org", async (original) => ({
  ...(await original<typeof import("@pm-collab/core/shared/org")>()),
  listOrgs: vi.fn(),
  ensureSystemOrg: vi.fn(),
}));

import { prisma } from "@pm-collab/db/prisma";
import { revokeUserSessions } from "@pm-collab/core/auth";
import { issueInvite } from "@pm-collab/core/login/links";
import { listOrgs } from "@pm-collab/core/shared/org";
import { enterpriseAuthority } from "@pm-collab/core/shared/enterprise-admin";
import { canAssignRole } from "@pm-collab/core/shared/admin-gate";
import * as enterprises from "@pm-collab/core/nova/enterprises";
import * as admins from "@pm-collab/core/nova/admins";

const ORGS = [
  { id: "org_nova_collab", name: "Weavi Space", type: "system", parentId: null, sortOrder: 0 },
  { id: "ent-a", name: "甲", type: "enterprise", parentId: "org_nova_collab", sortOrder: 0 },
  { id: "dept-a", name: "甲研发", type: "department", parentId: "ent-a", sortOrder: 0 },
  { id: "ent-b", name: "乙", type: "enterprise", parentId: "org_nova_collab", sortOrder: 1 },
];
const sys = { id: "sys", email: "s@x.test", name: "S", globalRole: "admin" };
const boss = { id: "boss", email: "b@x.test", name: "B", globalRole: "manager" };
const mgr = { id: "mgr", email: "m@x.test", name: "M", globalRole: "manager" };
// 甲企业的企业超管是 boss
const adminOf: Record<string, string> = { boss: "ent-a" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listOrgs).mockResolvedValue(ORGS);
  vi.mocked(prisma.organization.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
    if (typeof where.adminUserId === "string") {
      const ent = adminOf[where.adminUserId];
      const not = (where.NOT as { id?: string } | undefined)?.id;
      return ent && ent !== not ? { id: ent, name: ent } : null;
    }
    if (typeof where.code === "string") return where.code === "taken" ? { id: "ent-b" } : null;
    if (where.id && where.type === "enterprise") return ORGS.find((o) => o.id === where.id && o.type === "enterprise") ? { id: where.id, name: "甲", code: "jia", adminUserId: null } : null;
    return null;
  }) as never);
});

describe("企业超管权限规则", () => {
  it("其他管理者动不了企业超管", async () => {
    expect(await enterpriseAuthority(mgr, { id: "boss", globalRole: "manager", orgId: "ent-a" })).toBe("deny");
  });
  it("企业超管不能在成员接口改自己", async () => {
    expect(await enterpriseAuthority(boss, { id: "boss", globalRole: "manager", orgId: "ent-a" })).toBe("deny");
  });
  it("企业超管能管理本企业（含下级部门）的管理者", async () => {
    expect(await enterpriseAuthority(boss, { id: "mgr", globalRole: "manager", orgId: "dept-a" })).toBe("allow");
  });
  it("企业超管管不到别的企业，也管不到系统管理员", async () => {
    expect(await enterpriseAuthority(boss, { id: "x", globalRole: "manager", orgId: "ent-b" })).toBe("default");
    expect(await enterpriseAuthority(boss, { id: "sys", globalRole: "admin", orgId: "ent-a" })).toBe("default");
  });
  it("系统超管按原规则", async () => {
    expect(await enterpriseAuthority(sys, { id: "boss", globalRole: "manager", orgId: "ent-a" })).toBe("default");
  });
  it("企业超管能授予管理者，不能授予系统管理员；普通管理者不能授予管理者", async () => {
    expect(await canAssignRole(boss, "manager")).toBe(true);
    expect(await canAssignRole(boss, "admin")).toBe(false);
    expect(await canAssignRole(mgr, "manager")).toBe(false);
  });
});

describe("Weavi Space 后台 · 企业", () => {
  const forbidden = { body: { error: "只有 Weavi Space 系统超管可以管理企业" }, init: { status: 403 } };
  it("非系统超管一律 403，且不查库写库", async () => {
    expect(await enterprises.GET(boss)).toEqual(forbidden);
    expect(await enterprises.POST(boss, { name: "x", code: "abc" })).toEqual(forbidden);
    expect(await enterprises.PUT(boss, { id: "ent-a" }, { userId: "mgr" })).toEqual(forbidden);
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
  it.each([["a_1"], ["1abc"], ["a"], ["中文"]])("非法企业编码 %s 被拒", async (code) => {
    const res = await enterprises.POST(sys, { name: "丙", code });
    expect(res.init?.status).toBe(400);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });
  it("编码重复被拒", async () => {
    expect(await enterprises.POST(sys, { name: "丙", code: "taken" })).toEqual({ body: { error: "企业编码已被使用" }, init: { status: 400 } });
  });
  it("只能指定本企业的账号为超管", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "x", orgId: "ent-b", isActive: true, globalRole: "member" } as never);
    expect(await enterprises.PUT(sys, { id: "ent-a" }, { userId: "x" })).toEqual({ body: { error: "只能指定本企业里的账号" }, init: { status: 400 } });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
  it("已是别的企业超管的账号不能再指定", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "boss", orgId: "dept-a", isActive: true, globalRole: "manager" } as never);
    adminOf.boss = "ent-other";
    const res = await enterprises.PUT(sys, { id: "ent-a" }, { userId: "boss" });
    adminOf.boss = "ent-a";
    expect(res.init?.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
  it("指定成员为超管：升为管理者并作废会话", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", orgId: "dept-a", isActive: true, globalRole: "member" } as never);
    const res = await enterprises.PUT(sys, { id: "ent-a" }, { userId: "u1" });
    expect(res).toEqual({ body: { ok: true, adminUserId: "u1" }, init: undefined });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { globalRole: "manager" } });
    expect(revokeUserSessions).toHaveBeenCalledWith("u1");
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: "ent-a" }, data: { adminUserId: "u1" } });
  });
  it("新建账号为超管：不设密码，返回邀请链接", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "new", name: "新超管", email: "new@x.test" } as never);
    vi.mocked(issueInvite).mockResolvedValue({ link: "https://x/invite/abc", code: "ABCD-EFGH", emailed: false });
    const res = await enterprises.PUT(sys, { id: "ent-a" }, { name: "新超管", email: "New@X.test" }, "https://x");
    expect(res.body).toMatchObject({ ok: true, adminUserId: "new", inviteLink: "https://x/invite/abc", emailed: false });
    const data = vi.mocked(prisma.user.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ email: "new@x.test", passwordHash: null, globalRole: "manager", orgId: "ent-a", mustChangePassword: true });
    expect(issueInvite).toHaveBeenCalledWith({ id: "new", name: "新超管", email: "new@x.test" }, "sys", "https://x");
  });
});

describe("Weavi Space 后台 · 系统超管", () => {
  it("不能取消自己", async () => {
    expect((await admins.DELETE(sys, "http://x/api/nova/admins?id=sys")).init?.status).toBe(400);
  });
  it("至少保留一个启用的系统超管", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "a2", globalRole: "admin" } as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    expect(await admins.DELETE(sys, "http://x/api/nova/admins?id=a2")).toEqual({ body: { error: "至少要保留一个启用的系统超管" }, init: { status: 400 } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("企业超管不能兼任系统超管", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "boss", isActive: true, globalRole: "manager", orgId: "ent-a" } as never);
    expect((await admins.POST(sys, { userId: "boss" })).init?.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("非系统超管 403", async () => {
    expect((await admins.GET(boss)).init?.status).toBe(403);
    expect((await admins.POST(mgr, { userId: "x" })).init?.status).toBe(403);
  });
});
