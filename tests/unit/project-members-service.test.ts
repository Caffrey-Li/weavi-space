import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    projectMember: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn() }));
vi.mock("@pm-collab/core/shared/enterprise", () => ({ memberCandidateWhere: vi.fn(async () => ({})) }));
vi.mock("@pm-collab/core/shared/roles", () => ({ validPosition: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { canSeeProject } from "@pm-collab/core/access";
import { GET, POST, PATCH, DELETE } from "@pm-collab/core/projects/id-members";

const session = { id: "u1", email: "u@example.test", name: "U", globalRole: "member" };

describe("项目成员服务：可见性与写顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("不可见项目 GET 返回 404，不列举成员", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "p1" } as never);
    vi.mocked(canSeeProject).mockResolvedValue(false);
    const response = await GET(session, { id: "p1" });
    expect(response).toEqual({ body: { error: "项目不存在" }, init: { status: 404 } });
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it("跨企业不可见同样 404", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "other-ent" } as never);
    vi.mocked(canSeeProject).mockResolvedValue(false);
    const response = await GET(session, { id: "other-ent" });
    expect(response).toEqual({ body: { error: "项目不存在" }, init: { status: 404 } });
  });

  it("POST：无权限时先 403，不解析 body、不写库", async () => {
    vi.mocked(can).mockResolvedValue(false);
    const getBody = vi.fn(async () => ({ userIds: ["u2"] }));
    const response = await POST(session, { id: "p1" }, getBody);
    expect(response).toEqual({ body: { error: "无权限管理项目成员" }, init: { status: 403 } });
    expect(can).toHaveBeenCalledWith(session, "members.manage", "p1");
    expect(getBody).not.toHaveBeenCalled();
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.projectMember.create).not.toHaveBeenCalled();
  });

  it("PATCH：无权限时先 403，不解析 body", async () => {
    vi.mocked(can).mockResolvedValue(false);
    const getBody = vi.fn(async () => ({ memberId: "m1", role: "dev" }));
    const response = await PATCH(session, { id: "p1" }, getBody);
    expect(response).toEqual({ body: { error: "无权限管理项目成员" }, init: { status: 403 } });
    expect(getBody).not.toHaveBeenCalled();
    expect(prisma.projectMember.findUnique).not.toHaveBeenCalled();
  });

  it("DELETE：无权限时先 403，不解析 body", async () => {
    vi.mocked(can).mockResolvedValue(false);
    const getBody = vi.fn(async () => ({ memberId: "m1" }));
    const response = await DELETE(session, { id: "p1" }, getBody);
    expect(response).toEqual({ body: { error: "无权限管理项目成员" }, init: { status: 403 } });
    expect(getBody).not.toHaveBeenCalled();
    expect(prisma.projectMember.delete).not.toHaveBeenCalled();
  });

  it("POST：有权限且项目不存在返回 404，不创建成员", async () => {
    vi.mocked(can).mockResolvedValue(true);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    const response = await POST(session, { id: "p1" }, async () => ({ userIds: ["u2"] }));
    expect(response).toEqual({ body: { error: "项目不存在" }, init: { status: 404 } });
    expect(prisma.projectMember.create).not.toHaveBeenCalled();
  });
});
