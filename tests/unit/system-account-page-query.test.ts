import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectMember: { findMany: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/shared/roles", () => ({
  positionLabels: vi.fn(async () => ({})),
  roleLabels: vi.fn(async () => ({ member: "成员" })),
}));

import { prisma } from "@pm-collab/db/prisma";
import { loadAccountPage } from "@pm-collab/core/system/account-page-query";

const member = { id: "m1", email: "m@example.test", name: "Member", globalRole: "member", mustChangePassword: false };

describe("设置 · 账号页查询", () => {
  beforeEach(() => vi.resetAllMocks());

  it("按当前用户 ID 查岗位与所属项目，不扩大范围", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ position: null } as never);
    vi.mocked(prisma.projectMember.findMany).mockResolvedValue([]);
    const data = await loadAccountPage(member);
    expect(data.force).toBe(false);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: member.id }, select: { position: true, passwordHash: true } });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: member.id },
      include: { project: true },
      orderBy: { createdAt: "asc" },
    });
  });
});
