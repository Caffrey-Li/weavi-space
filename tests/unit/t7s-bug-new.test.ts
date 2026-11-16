import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Access } from "@pm-collab/core/access";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: { requirement: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, project: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("@pm-collab/core/access", async (importOriginal) => ({ ...await importOriginal<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { getAccess, projectWhere, requirementWhere } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { loadNewBugPage } from "@pm-collab/core/bugs/new-page-query";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
const access: Access = { userId: "u", scope: "involved", projectIds: ["mine"], tenantIds: ["mine"], enterpriseId: "a", orgIds: ["a"] };

describe("新建 Bug 页数据范围", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccess).mockResolvedValue(access);
    vi.mocked(can).mockResolvedValue(true);
  });
  it("不可见的项目和需求按不存在处理，查询带数据范围", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    const page = await loadNewBugPage(session, { project: "other", requirement: "other-req" });
    expect(page).toMatchObject({ requirement: null, project: null });
    expect(prisma.requirement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "other-req", AND: [requirementWhere(access)] } }));
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "other", AND: [projectWhere(access)] } }));
    expect(prisma.requirement.update).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
  it("同企业项目及其可见需求保持可用", async () => {
    const requirement = { id: "r", title: "需求", projectId: "mine", productId: null, productNodeId: null, project: { key: "M" } };
    const project = { id: "mine", name: "项目", key: "M", iconUrl: null };
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue(requirement as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue(project as never);
    expect(await loadNewBugPage(session, { requirement: "r" })).toEqual({ requirement, project, allowed: true });
  });
  it("指定的项目不可见时，仍可沿用可见需求所属的项目", async () => {
    const requirement = { id: "r", title: "需求", projectId: "mine", productId: null, productNodeId: null, project: { key: "M" } };
    const project = { id: "mine", name: "项目", key: "M", iconUrl: null };
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue(requirement as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce(project as never);
    expect(await loadNewBugPage(session, { project: "other", requirement: "r" })).toEqual({ requirement, project, allowed: true });
    expect(prisma.project.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "mine", AND: [projectWhere(access)] } }));
  });
  it("可见的公共池需求继续保留，且不查询项目", async () => {
    const requirement = { id: "pool", title: "公共池", projectId: null, productId: null, productNodeId: null, project: null };
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue(requirement as never);
    expect((await loadNewBugPage(session, { requirement: "pool" })).requirement).toEqual(requirement);
    expect(prisma.requirement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pool", AND: [requirementWhere(access)] } }));
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });
  it("未登录不查询指定的业务数据", async () => {
    expect(await loadNewBugPage(null, { project: "other", requirement: "r" })).toMatchObject({ requirement: null, project: null, allowed: false });
    expect(prisma.requirement.findFirst).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(getAccess).not.toHaveBeenCalled();
  });
});
