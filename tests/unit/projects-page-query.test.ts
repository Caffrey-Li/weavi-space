import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: { project: { findMany: vi.fn() } } }));
vi.mock("@pm-collab/core/access", async (original) => ({ ...await original<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn() }));
vi.mock("@pm-collab/core/shared/project-progress", () => ({ projectProgress: vi.fn().mockResolvedValue({}) }));

import { prisma } from "@pm-collab/db/prisma";
import { getAccess, type Access } from "@pm-collab/core/access";
import { loadProjectsPageData } from "@pm-collab/core/projects/list-page-query";

const user = { id: "user-a", email: "a@example.test", name: "A", globalRole: "member" };
const access: Access = { userId: user.id, scope: "involved", projectIds: ["project-a"], tenantIds: ["project-a"], enterpriseId: "enterprise-a", orgIds: ["enterprise-a"] };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(prisma.project.findMany).mockResolvedValue([]); });

describe("项目列表查询", () => {
  it("保留角色可见项目过滤和排序", async () => {
    vi.mocked(getAccess).mockResolvedValue(access);
    await loadProjectsPageData(user, { q: "", status: "", sort: "created" });
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["project-a"] }, status: { not: "space" } }, orderBy: [{ createdAt: "asc" }],
    }));
  });
  it("匿名访问仅查询空范围，不请求访问权限", async () => {
    await loadProjectsPageData(null, { q: "", status: "", sort: "created" });
    expect(getAccess).not.toHaveBeenCalled();
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "__none__", status: { not: "space" } } }));
  });
});
