import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    position: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    user: { groupBy: vi.fn(), count: vi.fn() },
    projectMember: { groupBy: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@pm-collab/core/shared/roles", () => ({ listPositions: vi.fn() }));
vi.mock("@pm-collab/core/shared/admin-gate", () => ({ randomKey: vi.fn(() => "pos_abc123") }));

import { prisma } from "@pm-collab/db/prisma";
import { listPositions } from "@pm-collab/core/shared/roles";
import { POST, DELETE } from "@pm-collab/core/positions/root";

const session = { id: "admin", email: "a@example.test", name: "A", globalRole: "admin" };

describe("岗位服务校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("POST 空名称先 400，不 listPositions / 写库", async () => {
    const response = await POST(session, { name: "  " });
    expect(response).toEqual({ body: { error: "请填写岗位名称" }, init: { status: 400 } });
    expect(listPositions).not.toHaveBeenCalled();
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  it("DELETE 岗位不存在先 404，不删", async () => {
    vi.mocked(prisma.position.findUnique).mockResolvedValue(null);
    const response = await DELETE(session, "http://localhost/api/positions?id=missing");
    expect(response).toEqual({ body: { error: "岗位不存在" }, init: { status: 404 } });
    expect(prisma.position.delete).not.toHaveBeenCalled();
  });

  it("DELETE 内置岗位先 400，不统计使用人数 / 不删", async () => {
    vi.mocked(prisma.position.findUnique).mockResolvedValue({ id: "1", key: "dev", name: "开发", isSystem: true } as never);
    const response = await DELETE(session, "http://localhost/api/positions?id=1");
    expect(response).toEqual({ body: { error: "内置岗位不能删除" }, init: { status: 400 } });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.position.delete).not.toHaveBeenCalled();
  });
});
