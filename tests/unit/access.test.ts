import { describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: {} }));
vi.mock("@pm-collab/core/shared/roles", () => ({ getRole: vi.fn() }));
vi.mock("@pm-collab/core/shared/org", () => ({ listOrgs: vi.fn() }));
import { bugWhere, productWhere, projectWhere, requirementWhere, userWhere, type Access } from "@pm-collab/core/access";

const access: Access = { userId: "u", scope: "involved", projectIds: ["p"], tenantIds: ["p", "p2"], enterpriseId: "e", orgIds: ["org"] };
describe("数据范围查询", () => {
  it("管理员不受项目、需求、Bug、产品或账号范围限制", () => {
    const admin: Access = { userId: "a", scope: "all", projectIds: null, tenantIds: null, enterpriseId: null, orgIds: null };
    for (const where of [projectWhere, requirementWhere, bugWhere, productWhere, userWhere]) expect(where(admin)).toEqual({});
  });
  it("参与范围限定项目，公共池只包含本企业和本人", () => {
    const pool = { projectId: null, OR: [{ creatorId: "u" }, { creator: { orgId: { in: ["org"] } } }] };
    expect(projectWhere(access)).toEqual({ id: { in: ["p"] } });
    expect(requirementWhere(access)).toEqual({ OR: [{ projectId: { in: ["p"] } }, pool] });
    expect(bugWhere(access)).toEqual({ OR: [{ projectId: { in: ["p"] } }, pool] });
    expect(userWhere(access)).toEqual({ OR: [{ orgId: { in: ["org"] } }, { id: "u" }] });
  });
  it("仅本人范围仍受企业限制", () => {
    const self = { ...access, scope: "self" as const };
    const pool = { projectId: null, OR: [{ creatorId: "u" }, { creator: { orgId: { in: ["org"] } } }] };
    expect(requirementWhere(self)).toMatchObject({ AND: [{ OR: [{ projectId: { in: ["p", "p2"] } }, pool] }, { OR: [{ creatorId: "u" }, { assignees: { some: { userId: "u" } } }] }] });
    expect(bugWhere(self)).toMatchObject({ AND: [{ OR: [{ projectId: { in: ["p", "p2"] } }, pool] }, { OR: [{ creatorId: "u" }, { assigneeId: "u" }, { frontendId: "u" }, { backendId: "u" }] }] });
    expect(productWhere(self)).toMatchObject({ enterpriseId: "e" });
  });
  it("无所属企业不会匹配其他企业产品", () => {
    expect(productWhere({ ...access, scope: "enterprise", enterpriseId: null })).toEqual({ enterpriseId: "__none__" });
  });
});
