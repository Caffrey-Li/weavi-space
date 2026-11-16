import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  project: { findMany: vi.fn(), findUnique: vi.fn() },
  requirement: { findMany: vi.fn() },
} }));
vi.mock("@pm-collab/core/access", async (original) => ({ ...await original<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { getAccess, requirementWhere, type Access } from "@pm-collab/core/access";
import { loadBoardCards, loadBoardContext } from "@pm-collab/core/requirements/board-query";

const user = { id: "user-a", email: "a@example.test", name: "A", globalRole: "member" };
const access: Access = { userId: user.id, scope: "involved", projectIds: ["project-a"], tenantIds: ["project-a"], enterpriseId: "enterprise-a", orgIds: ["enterprise-a"] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getAccess).mockResolvedValue(access); });

describe("需求看板服务查询", () => {
  it("项目列表只查询当前角色可见范围，并沿用原有顺序", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: "project-a" }] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "project-a" } as never);
    const context = await loadBoardContext(user, "project-a");
    expect(context.projects.map((project) => project.id)).toEqual(["project-a"]);
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active", id: { in: ["project-a"] } }, orderBy: { createdAt: "asc" } }));
    expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: "project-a" } });
  });
  it("看板需求保留企业和角色范围条件，不包含其他企业", async () => {
    vi.mocked(prisma.requirement.findMany).mockResolvedValue([]);
    await loadBoardCards(access, [{ id: "project-a" }] as never, "");
    expect(prisma.requirement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ["project-a"] }, AND: [requirementWhere(access)] }),
      orderBy: { boardOrder: "asc" },
    }));
    expect(JSON.stringify(vi.mocked(prisma.requirement.findMany).mock.calls)).not.toContain("project-b");
  });
  it("未登录时数据查询使用空范围", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
    await loadBoardContext(null, "");
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active", id: "__none__" } }));
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
