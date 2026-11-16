import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { session: { updateMany: vi.fn() }, apiToken: { updateMany: vi.fn() }, $transaction: vi.fn() } }));
import { prisma } from "@pm-collab/db/prisma";
import { revokeUserSessions } from "@pm-collab/core/auth";

beforeEach(() => vi.clearAllMocks());
it("吊销用户会话时在同一事务内吊销该用户全部令牌", async () => {
  await revokeUserSessions(["a", "b"], "keep");
  expect(prisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["a", "b"] }, revokedAt: null, NOT: { id: "keep" } } }));
  expect(prisma.apiToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["a", "b"] }, revokedAt: null } }));
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(prisma.$transaction).mock.calls[0][0]).toHaveLength(2);
});
