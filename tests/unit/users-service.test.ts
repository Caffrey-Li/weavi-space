import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
    activityLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@pm-collab/core/auth", () => ({
  hashPassword: vi.fn(async () => "hashed"),
  revokeUserSessions: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/roles", () => ({
  validRole: vi.fn(),
  validPosition: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/admin-gate", () => ({
  canAssignRole: vi.fn(),
  userScope: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/org", () => ({
  SYSTEM_ORG_ID: "org_system",
  canManageUser: vi.fn(),
  ensureSystemOrg: vi.fn(),
  level2OrgId: vi.fn(),
  listOrgs: vi.fn(async () => []),
}));
// 企业超管规则单独在 t15-enterprise-admin.test.ts 测；这里保持原来的角色 + 范围判断
vi.mock("@pm-collab/core/shared/enterprise-admin", () => ({
  enterpriseAuthority: vi.fn(async () => "default"),
  enterpriseAdminOf: vi.fn(async () => null),
  enterpriseAdminIds: vi.fn(async () => []),
}));
vi.mock("@pm-collab/core/shared/password-policy", () => ({
  passwordProblem: vi.fn(() => null),
}));

import { prisma } from "@pm-collab/db/prisma";
import { hashPassword, revokeUserSessions } from "@pm-collab/core/auth";
import { validRole } from "@pm-collab/core/shared/roles";
import { canAssignRole, userScope } from "@pm-collab/core/shared/admin-gate";
import { canManageUser } from "@pm-collab/core/shared/org";
import { passwordProblem } from "@pm-collab/core/shared/password-policy";
import { POST, PATCH as patchUser, DELETE } from "@pm-collab/core/users/root";
import { PATCH as patchBatch } from "@pm-collab/core/users/batch";

const admin = { id: "admin1", email: "admin@example.test", name: "Admin", globalRole: "admin" };
const manager = { id: "mgr1", email: "mgr@example.test", name: "Mgr", globalRole: "manager" };

describe("POST /api/users 非法输入不写库", () => {
  beforeEach(() => vi.resetAllMocks());

  it("缺姓名/账号先 400，不校验角色 / 写库", async () => {
    const response = await POST(admin, { name: " ", account: "" });
    expect(response).toEqual({ body: { error: "姓名、账号（邮箱）必填" }, init: { status: 400 } });
    expect(validRole).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("管理员不能设置初始密码：带 password 一律 400，不查角色 / 写库", async () => {
    const response = await POST(admin, { name: "张三", account: "zhang@example.test", password: "Abcdefg1234" });
    expect(response).toEqual({ body: { error: "管理员不能设置账号密码，请用邀请链接，由本人首次登录时设置" }, init: { status: 400 } });
    expect(validRole).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("角色不存在先 400，早于 canAssignRole / 写库", async () => {
    vi.mocked(validRole).mockResolvedValue(false);
    const response = await POST(admin, { name: "张三", account: "zhang@example.test", globalRole: "ghost" });
    expect(response).toEqual({ body: { error: "角色不存在" }, init: { status: 400 } });
    expect(canAssignRole).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users 校验顺序与无写", () => {
  beforeEach(() => vi.resetAllMocks());

  it("缺 id 先 400，不查用户", async () => {
    const response = await patchUser(admin, {});
    expect(response).toEqual({ body: { error: "缺少用户 id" }, init: { status: 400 } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("用户不存在先 404，不查 scope / 不写", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const response = await patchUser(admin, { id: "missing", name: "新名" });
    expect(response).toEqual({ body: { error: "用户不存在" }, init: { status: 404 } });
    expect(userScope).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("跨企业管理范围外账号先 403，不写库", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u2",
      email: "u2@example.test",
      name: "U2",
      globalRole: "member",
      orgId: "other_org",
      isActive: true,
    } as never);
    vi.mocked(userScope).mockResolvedValue(new Set(["my_org"]));
    vi.mocked(canManageUser).mockReturnValue(false);
    const response = await patchUser(manager, { id: "u2", name: "改名" });
    expect(response).toEqual({ body: { error: "只能修改自己管理的组织里级别比自己低的账号" }, init: { status: 403 } });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/users 非法输入不写", () => {
  beforeEach(() => vi.resetAllMocks());

  it("缺 id 先 400，不查用户 / 不删", async () => {
    const response = await DELETE(admin, "http://localhost/api/users");
    expect(response).toEqual({ body: { error: "缺少用户 id" }, init: { status: 400 } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("不能删除自己，先于查库", async () => {
    const response = await DELETE(admin, "http://localhost/api/users?id=admin1");
    expect(response).toEqual({ body: { error: "不能删除自己的账号" }, init: { status: 400 } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/batch 跨企业边界与非法输入不写", () => {
  beforeEach(() => vi.resetAllMocks());

  it("未选成员先 400，不查 scope / 不写", async () => {
    const response = await patchBatch(admin, { ids: [], globalRole: "member" });
    expect(response).toEqual({ body: { error: "请先选择成员" }, init: { status: 400 } });
    expect(userScope).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("跨企业不可管理账号整批 403（边界拒绝），不 updateMany", async () => {
    vi.mocked(userScope).mockResolvedValue(new Set(["my_org"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { globalRole: "member", orgId: "my_org" },
      { globalRole: "member", orgId: "other_org" },
    ] as never);
    vi.mocked(canManageUser).mockImplementation((_role, scope, target) => {
      if (!scope) return true;
      return !!(target.orgId && scope.has(target.orgId));
    });
    const response = await patchBatch(manager, {
      ids: ["u1", "u2"],
      globalRole: "guest",
    });
    expect(response).toEqual({ body: { error: "选中的成员里有不归你管理的账号，不能调整" }, init: { status: 403 } });
    expect(validRole).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });

  it("角色不存在先 400，不写库", async () => {
    vi.mocked(userScope).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ globalRole: "member", orgId: "o1" }] as never);
    vi.mocked(canManageUser).mockReturnValue(true);
    vi.mocked(validRole).mockResolvedValue(false);
    const response = await patchBatch(admin, { ids: ["u1"], globalRole: "ghost" });
    expect(response).toEqual({ body: { error: "角色不存在" }, init: { status: 400 } });
    expect(canAssignRole).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("管理员不能批量取消自己的 admin，先于 canAssignRole / 写库", async () => {
    vi.mocked(userScope).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ globalRole: "admin", orgId: null }] as never);
    vi.mocked(canManageUser).mockReturnValue(true);
    vi.mocked(validRole).mockResolvedValue(true);
    const response = await patchBatch(admin, { ids: ["admin1", "u2"], globalRole: "member" });
    expect(response).toEqual({
      body: { error: "选中的成员里有你自己，不能取消自己的系统管理员角色" },
      init: { status: 400 },
    });
    expect(canAssignRole).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("没有要调整的内容先 400，不写库", async () => {
    vi.mocked(userScope).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ globalRole: "member", orgId: "o1" }] as never);
    vi.mocked(canManageUser).mockReturnValue(true);
    const response = await patchBatch(admin, { ids: ["u1"] });
    expect(response).toEqual({ body: { error: "没有要调整的内容" }, init: { status: 400 } });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
