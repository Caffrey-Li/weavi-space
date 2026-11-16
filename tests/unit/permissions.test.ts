import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: { rolePermission: { findMany: vi.fn() } } }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn() }));
import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject } from "@pm-collab/core/access";
import { can, canMany } from "@pm-collab/core/permissions";
import { defaultRoleAllow } from "@pm-collab/core/shared/roles-shared";

describe("默认权限矩阵", () => {
  it.each([
    ["admin", "bugs.delete", true], ["manager", "bugs.delete", true],
    ["member", "bugs.delete", false], ["project_manager", "bugs.delete", true],
    ["member", "requirements.create", true], ["guest", "requirements.create", false],
    ["guest", "leadership.view", true], ["custom", "unknown", false],
  ])("%s / %s = %s", (role, feature, expected) => {
    expect(defaultRoleAllow(role, feature)).toBe(expected);
  });
});

describe("功能权限与数据范围", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("系统管理员直接放行", async () => {
    expect(await can({ id: "a", globalRole: "admin" }, "anything", "p")).toBe(true);
    expect(canSeeProject).not.toHaveBeenCalled();
  });
  it("项目不可见时，即使默认允许也拒绝", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(false);
    expect(await can({ id: "u", globalRole: "member" }, "requirements.create", "other")).toBe(false);
  });
  it("显式矩阵值覆盖默认值", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(true);
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([{ feature: "bugs.delete", allowed: true }, { feature: "requirements.create", allowed: false }] as never);
    const user = { id: "u", globalRole: "member" };
    expect(await can(user, "bugs.delete", "p")).toBe(true);
    expect(await can(user, "requirements.create", "p")).toBe(false);
  });
  it("未登录的批量权限均为 false", async () => {
    expect(await canMany(null, ["bugs.edit", "docs.edit"] as const)).toEqual({ "bugs.edit": false, "docs.edit": false });
  });
});
