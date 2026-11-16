import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    rolePermission: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/shared/roles", () => ({ listRoles: vi.fn() }));
vi.mock("@pm-collab/core/shared/constants", () => ({
  FEATURES: [{ key: "users.manage", label: "账号管理" }],
}));

import { prisma } from "@pm-collab/db/prisma";
import { listRoles } from "@pm-collab/core/shared/roles";
import { PATCH } from "@pm-collab/core/permissions/root";

const session = { id: "admin", email: "a@example.test", name: "A", globalRole: "admin" };

describe("权限矩阵 PATCH 校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("缺 role/feature 先 400，不查角色 / 写库", async () => {
    const response = await PATCH(session, { role: "", feature: "users.manage", allowed: true });
    expect(response).toEqual({ body: { error: "role / feature 必填" }, init: { status: 400 } });
    expect(listRoles).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("admin 角色固定全部权限，先于 listRoles / upsert", async () => {
    const response = await PATCH(session, { role: "admin", feature: "users.manage", allowed: false });
    expect(response).toEqual({ body: { error: "系统管理员固定拥有全部权限" }, init: { status: 400 } });
    expect(listRoles).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("角色不存在返回 400，不 upsert", async () => {
    vi.mocked(listRoles).mockResolvedValue([{ key: "member" }] as never);
    const response = await PATCH(session, { role: "ghost", feature: "users.manage", allowed: true });
    expect(response).toEqual({ body: { error: "角色不存在" }, init: { status: 400 } });
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });
});
