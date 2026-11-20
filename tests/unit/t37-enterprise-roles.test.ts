import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ roles: [] as { key: string; enterpriseId: string; name: string }[], userEnt: "entA", ceiling: ["requirements.create", "docs.edit"] as string[], perms: [] as { feature: string; allowed: boolean }[] }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { rolePermission: { findMany: vi.fn(async () => mock.perms) } } }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/shared/roles", () => ({
  listRoles: vi.fn(async () => mock.roles),
  roleFitsEnterprise: vi.fn(async (key: string, ent: string) => {
    const r = mock.roles.find((x) => x.key === key);
    return Boolean(r) && (!r!.enterpriseId || r!.enterpriseId === ent);
  }),
}));
vi.mock("@pm-collab/core/shared/role-ceiling", async (orig) => ({
  ...(await orig<typeof import("@pm-collab/core/shared/role-ceiling")>()),
  enterpriseOfUserId: vi.fn(async () => mock.userEnt),
  roleCeiling: vi.fn(async () => mock.ceiling),
}));

import { can } from "@pm-collab/core/permissions";
import { parseCeiling } from "@pm-collab/core/shared/role-ceiling";
import { roleFitsEnterprise } from "@pm-collab/core/shared/roles";

beforeEach(() => {
  mock.roles = [{ key: "member", enterpriseId: "", name: "成员" }, { key: "ent_abc123", enterpriseId: "entA", name: "外包" }];
  mock.userEnt = "entA";
  mock.ceiling = ["requirements.create", "docs.edit"];
  mock.perms = [{ feature: "requirements.create", allowed: true }, { feature: "bugs.delete", allowed: true }];
});

describe("T37 企业角色的权限判断", () => {
  it("本企业的人：开通且在上限内的功能放行", async () => {
    expect(await can({ id: "u1", globalRole: "ent_abc123" }, "requirements.create")).toBe(true);
  });
  it("开通了但超出企业上限的功能拒绝", async () => {
    expect(await can({ id: "u2", globalRole: "ent_abc123" }, "bugs.delete")).toBe(false);
  });
  it("换到别的企业的人，企业角色一律不放行", async () => {
    mock.userEnt = "entB";
    expect(await can({ id: "u3", globalRole: "ent_abc123" }, "requirements.create")).toBe(false);
  });
  it("系统角色不受企业上限影响", async () => {
    mock.ceiling = [];
    expect(await can({ id: "u4", globalRole: "member" }, "requirements.create")).toBe(true);
  });
});

describe("T37 企业角色只能给本企业的人", () => {
  it("系统角色谁都能用，企业角色只限本企业", async () => {
    expect(await roleFitsEnterprise("member", "entB")).toBe(true);
    expect(await roleFitsEnterprise("ent_abc123", "entA")).toBe(true);
    expect(await roleFitsEnterprise("ent_abc123", "entB")).toBe(false);
    expect(await roleFitsEnterprise("ent_abc123", "")).toBe(false);
    expect(await roleFitsEnterprise("nope", "entA")).toBe(false);
  });
});

describe("T37 企业权限上限解析", () => {
  it("没设过 = 全部功能；只保留认识的功能点；坏数据按全部关闭", () => {
    expect(parseCeiling(null).length).toBeGreaterThan(5);
    expect(parseCeiling(JSON.stringify(["docs.edit", "x.y"]))).toEqual(["docs.edit"]);
    expect(parseCeiling("{坏")).toEqual([]);
  });
});
