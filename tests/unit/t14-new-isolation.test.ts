import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  requirement: { findFirst: vi.fn(), create: vi.fn() },
  release: { findUnique: vi.fn(), create: vi.fn() },
} }));
vi.mock("@pm-collab/core/access", async (original) => ({ ...await original<typeof import("@pm-collab/core/access")>(), getAccess: vi.fn(), canSeeProject: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject, getAccess, type Access } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { loadNewRequirementPage } from "@pm-collab/core/requirements/new-page-query";
import { POST as createRequirement } from "@pm-collab/core/requirements/root";
import { POST as createRelease } from "@pm-collab/core/releases/index";

const member = { id: "user-a", email: "a@example.test", name: "A", globalRole: "member" };
const admin = { ...member, id: "admin", globalRole: "admin" };
const memberAccess: Access = { userId: "user-a", scope: "enterprise", projectIds: ["project-a"], tenantIds: ["project-a"], enterpriseId: "enterprise-a", orgIds: ["enterprise-a"] };
const adminAccess: Access = { userId: "admin", scope: "all", projectIds: null, tenantIds: null, enterpriseId: null, orgIds: null };
const projects = [
  { id: "project-a", name: "甲项目", iconUrl: null },
  { id: "project-b", name: "乙项目机密", iconUrl: null },
];
const requirements = [
  { id: "req-a", title: "甲需求", projectId: "project-a" },
  { id: "req-b", title: "乙需求机密", projectId: "project-b" },
];
type Where = { where: { id: string; AND?: { id?: { in: string[] }; projectId?: { in: string[] } }[] } };
const inScope = (ids: string[] | undefined, id: string) => !ids || ids.includes(id);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAccess).mockImplementation((async (u: { id: string }) => (u.id === "admin" ? adminAccess : memberAccess)) as never);
  vi.mocked(canSeeProject).mockImplementation((async (u: { id: string }, id: string) => u.id === "admin" || memberAccess.projectIds!.includes(id)) as never);
  vi.mocked(can).mockResolvedValue(true);
  vi.mocked(prisma.project.findFirst).mockImplementation((async ({ where }: Where) => {
    const p = projects.find((x) => x.id === where.id);
    return p && inScope(where.AND?.[0]?.id?.in, p.id) ? p : null;
  }) as never);
  vi.mocked(prisma.project.findUnique).mockImplementation((async ({ where }: Where) => projects.find((x) => x.id === where.id) ?? null) as never);
  vi.mocked(prisma.requirement.findFirst).mockImplementation((async ({ where }: Where) => {
    const r = requirements.find((x) => x.id === where.id);
    const scope = JSON.stringify(where.AND ?? []);
    const visible = !r ? false : !scope.includes("project-a") || r.projectId === "project-a";
    return r && visible ? { id: r.id, title: r.title } : null;
  }) as never);
});

describe("新建需求页按数据范围查项目和父需求", () => {
  it("同企业项目和父需求正常显示", async () => {
    const data = await loadNewRequirementPage(member, { project: "project-a", parent: "req-a" });
    expect(data.project?.name).toBe("甲项目");
    expect(data.parent?.title).toBe("甲需求");
    expect(can).toHaveBeenCalledWith(member, "requirements.create", "project-a");
  });

  it("跨企业项目、父需求与不存在的 id 行为一致", async () => {
    const cross = await loadNewRequirementPage(member, { project: "project-b", parent: "req-b" });
    const none = await loadNewRequirementPage(member, { project: "nope", parent: "nope" });
    expect(cross).toEqual(none);
    expect(cross.project).toBeNull();
    expect(cross.parent).toBeNull();
    expect(JSON.stringify(cross)).not.toContain("机密");
  });

  it("系统管理员不受影响", async () => {
    const data = await loadNewRequirementPage(admin, { project: "project-b", parent: "req-b" });
    expect(data.project?.name).toBe("乙项目机密");
    expect(data.parent?.title).toBe("乙需求机密");
  });

  it("未登录不查库", async () => {
    expect(await loadNewRequirementPage(null, { project: "project-a" })).toEqual({ project: null, parent: null, allowed: false });
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe("新建需求 / 发版：看不到的项目按不存在处理，先于功能权限", () => {
  const notFound = { body: { error: "项目不存在" }, init: { status: 404 } };

  it.each([
    ["新建需求", (pid: string) => createRequirement(member, { title: "x", projectId: pid })],
    ["新建发版", (pid: string) => createRelease(member, { projectId: pid, version: "1.0.0" })],
  ])("%s：跨企业项目和不存在的 id 都返回 404，且不查功能权限", async (_n, run) => {
    vi.mocked(can).mockResolvedValue(false);
    expect(await run("project-b")).toEqual(notFound);
    expect(await run("nope")).toEqual(notFound);
    expect(can).not.toHaveBeenCalled();
  });

  it.each([
    ["新建需求", (pid: string) => createRequirement(member, { title: "x", projectId: pid }), "无权限新建需求"],
    ["新建发版", (pid: string) => createRelease(member, { projectId: pid, version: "1.0.0" }), "无权限管理该项目发版"],
  ])("%s：本企业项目无权限仍返回 403", async (_n, run, error) => {
    vi.mocked(can).mockResolvedValue(false);
    expect(await run("project-a")).toEqual({ body: { error }, init: { status: 403 } });
  });

  it("系统管理员可对任意企业项目新建发版（通过项目检查）", async () => {
    vi.mocked(can).mockResolvedValue(false);
    expect(await createRelease(admin, { projectId: "project-b", version: "1.0.0" })).toEqual({ body: { error: "无权限管理该项目发版" }, init: { status: 403 } });
  });
});
