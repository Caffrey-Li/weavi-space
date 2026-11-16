import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  product: { findUnique: vi.fn() },
  productNode: { findUnique: vi.fn(), findMany: vi.fn() },
  project: { findMany: vi.fn(), findUnique: vi.fn() },
  requirement: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
} }));
vi.mock("@pm-collab/core/access", async (original) => ({ ...await original<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn() }));
vi.mock("@pm-collab/core/shared/req-stages", () => ({ getHiddenStatuses: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { getAccess, type Access } from "@pm-collab/core/access";
import { getHiddenStatuses } from "@pm-collab/core/shared/req-stages";
import { loadRequirementsPool } from "@pm-collab/core/requirements/pool-query";

const member = { id: "user-a", email: "a@example.test", name: "A", globalRole: "member" };
const admin = { ...member, id: "admin", globalRole: "admin" };
const memberAccess: Access = { userId: "user-a", scope: "enterprise", projectIds: ["project-a"], tenantIds: ["project-a"], enterpriseId: "enterprise-a", orgIds: ["enterprise-a"] };
const adminAccess: Access = { userId: "admin", scope: "all", projectIds: null, tenantIds: null, enterpriseId: null, orgIds: null };
const products = {
  a: { id: "a", name: "甲产品", enterpriseId: "enterprise-a" },
  b: { id: "b", name: "乙产品机密", enterpriseId: "enterprise-b" },
};
const nodes = {
  a: { id: "node-a", name: "甲模块", productId: "a" },
  b: { id: "node-b", name: "乙模块机密", productId: "b" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAccess).mockResolvedValue(memberAccess);
  vi.mocked(getHiddenStatuses).mockResolvedValue([]);
  vi.mocked(prisma.requirement.count).mockResolvedValue(0);
  vi.mocked(prisma.requirement.findMany).mockResolvedValue([]);
  vi.mocked(prisma.requirement.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.project.findMany).mockResolvedValue([]);
  vi.mocked(prisma.productNode.findUnique).mockImplementation(vi.fn(async (args: { where: { id?: string } }) => Object.values(nodes).find((n) => n.id === args.where.id) ?? null) as never);
  vi.mocked(prisma.productNode.findMany).mockResolvedValue([]);
  vi.mocked(prisma.product.findUnique).mockImplementation(vi.fn(async (args: { where: { id?: string; AND: { enterpriseId?: string }[] } }) => {
    const product = Object.values(products).find((p) => p.id === args.where.id);
    const filters = args.where.AND as { enterpriseId?: string }[];
    return product && (!filters[0].enterpriseId || product.enterpriseId === filters[0].enterpriseId) ? product : null;
  }) as never);
});

describe("需求池产品和功能模块筛选范围", () => {
  it.each([
    ["product", "a", "甲产品"],
    ["productNode", "node-a", "甲模块"],
  ])("同企业可见的 %s 显示筛选名称", async (key, id, name) => {
    const data = await loadRequirementsPool({ searchParams: { [key]: id } }, member);
    expect(JSON.stringify(data)).toContain(name);
    expect(data.hasFilters).toBe(true);
  });

  it.each([
    ["product", "b", "乙产品机密"],
    ["productNode", "node-b", "乙模块机密"],
  ])("跨企业不可见的 %s 和不存在 ID 行为一致", async (key, id, name) => {
    const invisible = await loadRequirementsPool({ searchParams: { [key]: id } }, member);
    const missing = await loadRequirementsPool({ searchParams: { [key]: "missing" } }, member);
    expect(invisible).toEqual(missing);
    expect(JSON.stringify(invisible)).not.toContain(name);
    expect(invisible.hasFilters).toBe(false);
  });

  it.each([
    ["product", "b", "乙产品机密"],
    ["productNode", "node-b", "乙模块机密"],
  ])("系统管理员仍可见 %s 的名称", async (key, id, name) => {
    vi.mocked(getAccess).mockResolvedValue(adminAccess);
    const data = await loadRequirementsPool({ searchParams: { [key]: id } }, admin);
    expect(JSON.stringify(data)).toContain(name);
    expect(data.hasFilters).toBe(true);
  });
});
