import { beforeEach, describe, expect, it, vi } from "vitest";

// T32：所有带项目 id 的写接口，看不到的项目和不存在的项目返回同样的 404，并且先于功能权限判断
vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  requirement: { findFirst: vi.fn(), findUnique: vi.fn() },
  release: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
} }));
vi.mock("@pm-collab/core/access", async (original) => ({ ...await original<typeof import("@pm-collab/core/access")>(), canSeeProject: vi.fn(), requirementVisible: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject, requirementVisible } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { POST as createBug } from "@pm-collab/core/bugs/index";
import { POST as createHotfix } from "@pm-collab/core/releases/hotfix";

const member = { id: "user-a", email: "a@example.test", name: "A", globalRole: "member" };
const admin = { ...member, id: "admin", globalRole: "admin" };
const projects = [
  { id: "project-a", status: "active" },
  { id: "project-b", status: "active" },
];
const requirements = [
  { id: "req-a", projectId: "project-a" },
  { id: "req-b", projectId: "project-b" },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canSeeProject).mockImplementation((async (u: { id: string }, id: string) => u.id === "admin" ? projects.some((p) => p.id === id) : id === "project-a") as never);
  vi.mocked(requirementVisible).mockImplementation((async (u: { id: string }, id: string) => u.id === "admin" ? requirements.some((r) => r.id === id) : id === "req-a") as never);
  vi.mocked(can).mockResolvedValue(false);
  vi.mocked(prisma.project.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) => projects.find((p) => p.id === where.id) ?? null) as never);
  vi.mocked(prisma.requirement.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) => requirements.find((r) => r.id === where.id) ?? null) as never);
});

type R = { body: unknown; init?: { status: number } };
const read = (res: R) => ({ status: res.init?.status ?? 200, body: res.body });

describe("新建 Bug", () => {
  it("跨企业项目与不存在的项目一致返回 404，不查功能权限", async () => {
    const cross = await read(await createBug(member as never, { title: "x", projectId: "project-b" }));
    const none = await read(await createBug(member as never, { title: "x", projectId: "no-such" }));
    expect(cross.status).toBe(404);
    expect(cross).toEqual(none);
    expect(can).not.toHaveBeenCalled();
  });

  it("跨企业需求与不存在的需求一致返回 404", async () => {
    const cross = await read(await createBug(member as never, { title: "x", projectId: "project-a", requirementId: "req-b" }));
    const none = await read(await createBug(member as never, { title: "x", projectId: "project-a", requirementId: "no-such" }));
    expect(cross.status).toBe(404);
    expect(cross).toEqual(none);
  });

  it("本企业项目通过可见性检查，再由功能权限决定", async () => {
    const res = read(await createBug(member as never, { title: "x", projectId: "project-a" }));
    expect(res.status).toBe(403);
    expect(can).toHaveBeenCalledWith(member, "bugs.edit", "project-a");
  });

  it("系统管理员能看到任意企业的项目", async () => {
    const res = read(await createBug(admin as never, { title: "x", projectId: "project-b" }));
    expect(res.status).toBe(403);
    expect(can).toHaveBeenCalledWith(admin, "bugs.edit", "project-b");
  });
});

describe("紧急发版", () => {
  const body = (projectId: string) => ({ projectId, version: "1.0.1", reason: "线上故障" });

  it("跨企业项目与不存在的项目一致返回 404，不查功能权限", async () => {
    const cross = await read(await createHotfix(member as never, body("project-b")));
    const none = await read(await createHotfix(member as never, body("no-such")));
    expect(cross.status).toBe(404);
    expect(cross).toEqual(none);
    expect(can).not.toHaveBeenCalled();
  });

  it("本企业项目继续检查发版权限", async () => {
    const res = read(await createHotfix(member as never, body("project-a")));
    expect(res.status).toBe(403);
    expect(can).toHaveBeenCalledWith(member, "releases.manage", "project-a");
  });
});
