import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    role: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    rolePermission: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    user: { groupBy: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/shared/roles", () => ({ listRoles: vi.fn() }));
vi.mock("@pm-collab/core/shared/constants", () => ({
  FEATURES: [
    { key: "users.manage", label: "账号管理" },
    { key: "docs.read", label: "文档" },
  ],
}));
vi.mock("@pm-collab/core/shared/roles-shared", () => ({
  DATA_SCOPES: [
    { key: "all", label: "全部数据" },
    { key: "enterprise", label: "本企业" },
    { key: "involved", label: "参与的" },
  ],
  defaultRoleAllow: vi.fn(() => false),
}));
vi.mock("@pm-collab/core/shared/admin-gate", () => ({ randomKey: vi.fn(() => "role_abc123") }));

import { prisma } from "@pm-collab/db/prisma";
import { listRoles } from "@pm-collab/core/shared/roles";
import { POST, PATCH, DELETE } from "@pm-collab/core/roles/root";

const session = { id: "admin", email: "a@example.test", name: "A", globalRole: "admin" };

describe("POST /api/roles 非法输入不写", () => {
  beforeEach(() => vi.resetAllMocks());

  it("空名称先 400，不 listRoles / 写库", async () => {
    const response = await POST(session, { name: "  " });
    expect(response).toEqual({ body: { error: "请填写角色名称" }, init: { status: 400 } });
    expect(listRoles).not.toHaveBeenCalled();
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it("同名角色先 400，不 create", async () => {
    vi.mocked(listRoles).mockResolvedValue([{ key: "member", name: "成员", dataScope: "involved" }] as never);
    const response = await POST(session, { name: "成员" });
    expect(response).toEqual({ body: { error: "已有同名角色" }, init: { status: 400 } });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/roles 错误优先顺序与 admin 固定逻辑", () => {
  beforeEach(() => vi.resetAllMocks());

  it("角色不存在先 404，不写", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue(null);
    const response = await PATCH(session, { id: "missing", name: "新名" });
    expect(response).toEqual({ body: { error: "角色不存在" }, init: { status: 404 } });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("空名称先 400，早于 admin 固定校验与写库", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue({
      id: "r1",
      key: "admin",
      name: "系统管理员",
      dataScope: "all",
    } as never);
    const response = await PATCH(session, { id: "r1", name: "  ", permissions: { "users.manage": false } });
    expect(response).toEqual({ body: { error: "角色名称不能为空" }, init: { status: 400 } });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("admin 改权限/数据范围先 400，不 update / upsert", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue({
      id: "r1",
      key: "admin",
      name: "系统管理员",
      dataScope: "all",
    } as never);
    const response = await PATCH(session, {
      id: "r1",
      permissions: { "users.manage": false, "docs.read": false },
    });
    expect(response).toEqual({ body: { error: "系统管理员固定拥有全部权限，不能修改" }, init: { status: 400 } });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("非 admin 非法 dataScope 先 400，早于写权限", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue({
      id: "r2",
      key: "member",
      name: "成员",
      dataScope: "involved",
    } as never);
    const response = await PATCH(session, { id: "r2", dataScope: "all" });
    expect(response).toEqual({ body: { error: "数据范围不合法" }, init: { status: 400 } });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("写权限时跳过未知 FEATURE，只 upsert 合法 key", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue({
      id: "r2",
      key: "member",
      name: "成员",
      dataScope: "involved",
    } as never);
    vi.mocked(prisma.rolePermission.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.activityLog.create).mockResolvedValue({} as never);
    const response = await PATCH(session, {
      id: "r2",
      permissions: { "users.manage": true, "not.a.feature": false, "docs.read": false },
    });
    expect(response).toEqual({ body: { ok: true } });
    expect(prisma.rolePermission.upsert).toHaveBeenCalledTimes(2);
    const features = vi.mocked(prisma.rolePermission.upsert).mock.calls.map((c) => (c[0] as { where: { scope_role_feature: { feature: string } } }).where.scope_role_feature.feature);
    expect(features.sort()).toEqual(["docs.read", "users.manage"]);
  });
});

describe("DELETE /api/roles 校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("角色不存在先 404，不删", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue(null);
    const response = await DELETE(session, "http://localhost/api/roles?id=missing");
    expect(response).toEqual({ body: { error: "角色不存在" }, init: { status: 404 } });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it("内置角色先 400，不统计人数 / 不删", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValue({
      id: "r1",
      key: "admin",
      name: "系统管理员",
      isSystem: true,
    } as never);
    const response = await DELETE(session, "http://localhost/api/roles?id=r1");
    expect(response).toEqual({ body: { error: "内置角色不能删除" }, init: { status: 400 } });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });
});
