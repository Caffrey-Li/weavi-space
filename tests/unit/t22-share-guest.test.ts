import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    projectShareLink: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    project: { findUnique: vi.fn() },
    requirement: { findMany: vi.fn() },
    release: { findMany: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { createShareLink, loadSharedProject, revokeShareLink } from "@pm-collab/core/share/service";
import { guestDemoEnabled, guestLogin } from "@pm-collab/core/login/guest";

const me = { id: "u1", email: "u1@x.test", name: "U1", globalRole: "member" };
const P = { id: "p1", name: "官网改版", description: "示例", status: "active", plannedEndAt: null, archivedAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.requirement.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.release.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.project.findUnique).mockResolvedValue(P as never);
  vi.mocked(prisma.activityLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.projectShareLink.update).mockResolvedValue({} as never);
});

describe("项目分享链接", () => {
  it("看不到项目 404，不能编辑项目 403，都不写库", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(false);
    expect((await createShareLink(me, "p1", {})).init?.status).toBe(404);
    vi.mocked(canSeeProject).mockResolvedValue(true);
    vi.mocked(can).mockResolvedValue(false);
    expect((await createShareLink(me, "p1", {})).init?.status).toBe(403);
    expect((await revokeShareLink(me, "p1", "l1")).init?.status).toBe(403);
    expect(prisma.projectShareLink.create).not.toHaveBeenCalled();
  });
  it("生成时只存令牌哈希，明文只返回一次；有效期只能选固定几档", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(true);
    vi.mocked(can).mockResolvedValue(true);
    expect((await createShareLink(me, "p1", { days: 3 })).init?.status).toBe(400);
    vi.mocked(prisma.projectShareLink.count).mockResolvedValue(0);
    vi.mocked(prisma.projectShareLink.create).mockImplementation((async (a: { data: Record<string, unknown> }) => ({ id: "l1", label: "", revokedAt: null, viewCount: 0, lastViewedAt: null, createdAt: new Date(), expiresAt: a.data.expiresAt })) as never);
    const r = await createShareLink(me, "p1", { days: 7, label: "客户" });
    const token = (r.body as { token: string }).token;
    const data = vi.mocked(prisma.projectShareLink.create).mock.calls[0][0].data as { tokenHash: string };
    expect(data.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(data)).not.toContain(token);
  });
  it("作废、过期、格式不对、项目归档都打不开", async () => {
    expect(await loadSharedProject("../etc")).toBeNull();
    vi.mocked(prisma.projectShareLink.findUnique).mockResolvedValue({ id: "l1", projectId: "p1", revokedAt: new Date(), expiresAt: null } as never);
    expect(await loadSharedProject("abc")).toBeNull();
    vi.mocked(prisma.projectShareLink.findUnique).mockResolvedValue({ id: "l1", projectId: "p1", revokedAt: null, expiresAt: new Date(Date.now() - 1000) } as never);
    expect(await loadSharedProject("abc")).toBeNull();
    vi.mocked(prisma.projectShareLink.findUnique).mockResolvedValue({ id: "l1", projectId: "p1", revokedAt: null, expiresAt: null } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ ...P, archivedAt: new Date() } as never);
    expect(await loadSharedProject("abc")).toBeNull();
  });
  it("有效链接只给标题、状态、优先级、日期，不带人和描述", async () => {
    vi.mocked(prisma.projectShareLink.findUnique).mockResolvedValue({ id: "l1", projectId: "p1", revokedAt: null, expiresAt: null } as never);
    vi.mocked(prisma.requirement.findMany).mockResolvedValue([{ title: "首页改版", status: "online", priority: "p1", plannedEndAt: null }, { title: "导出", status: "dev_in_progress", priority: "p2", plannedEndAt: null }] as never);
    const d = await loadSharedProject("abc");
    expect(d).toMatchObject({ total: 2, done: 1, progress: 50 });
    expect(Object.keys(d!.requirements[0]).sort()).toEqual(["plannedEndAt", "priority", "status", "statusLabel", "title"]);
    const where = vi.mocked(prisma.requirement.findMany).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({ projectId: "p1", archivedAt: null });
  });
});

describe("演示站访客体验", () => {
  it("默认关闭", async () => {
    vi.stubEnv("GUEST_DEMO", "");
    expect(guestDemoEnabled()).toBe(false);
    expect((await guestLogin("1.2.3.4")).init?.status).toBe(404);
    vi.unstubAllEnvs();
  });
});
