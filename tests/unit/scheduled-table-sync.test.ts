import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ enqueue: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), claim: vi.fn(), user: vi.fn(), activity: vi.fn(), can: vi.fn(), sync: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { feishuTableLink: { findMany: mock.findMany, findUnique: mock.findUnique, updateMany: mock.claim }, user: { findUnique: mock.user }, activityLog: { create: mock.activity } } }));
vi.mock("@/lib/scheduler-queue", () => ({ enqueueTableSync: mock.enqueue }));
vi.mock("@pm-collab/core/shared/feishu-table-links", () => ({ canSyncLink: mock.can, runLinkSync: mock.sync }));
import { enqueueDueTableSync, runAutoTableSync, runQueuedTableSync } from "@/lib/feishu-table-auto";
const now = new Date("2026-11-06T01:00:00Z");
const link = { id: "link", name: "测试表", autoSync: "pull", autoEvery: 15, lastAutoAt: null, createdById: "u" };
beforeEach(() => {
  vi.resetAllMocks(); mock.enqueue.mockResolvedValue("job"); mock.claim.mockResolvedValue({ count: 1 });
  mock.user.mockResolvedValue({ id: "u", name: "U", globalRole: "member", isActive: true }); mock.can.mockResolvedValue(true);
});
describe("飞书自动同步扫描和重试", () => {
  it("原公开函数仍直接执行并返回完成数量", async () => {
    mock.findMany.mockResolvedValue([link]);
    expect(await runAutoTableSync(now)).toBe(1);
    expect(mock.sync).toHaveBeenCalledOnce();
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("按原间隔与 30 秒容差入队", async () => {
    mock.findMany.mockResolvedValue([link, { ...link, id: "not-due", lastAutoAt: new Date(now.getTime() - 14 * 60_000) }, { ...link, id: "due", lastAutoAt: new Date(now.getTime() - 14.5 * 60_000) }]);
    expect(await enqueueDueTableSync(now)).toBe(2);
    expect(mock.enqueue.mock.calls).toEqual([["link", now], ["due", now]]);
    expect(mock.claim).not.toHaveBeenCalled();
  });
  it("失败上抛，同一任务重试时不重复领取", async () => {
    mock.findUnique.mockResolvedValueOnce(link).mockResolvedValueOnce({ ...link, lastAutoAt: now });
    mock.sync.mockRejectedValueOnce(new Error("临时失败")).mockResolvedValueOnce({});
    await expect(runQueuedTableSync("link", now.toISOString())).rejects.toThrow("临时失败");
    await runQueuedTableSync("link", now.toISOString());
    expect(mock.claim).toHaveBeenCalledTimes(1);
    expect(mock.sync).toHaveBeenCalledTimes(2);
  });
  it("其他执行已经更新时不重复同步", async () => {
    mock.findUnique.mockResolvedValue({ ...link, lastAutoAt: new Date(now.getTime() - 60_000) });
    await runQueuedTableSync("link", now.toISOString());
    expect(mock.claim).not.toHaveBeenCalled();
    expect(mock.sync).not.toHaveBeenCalled();
  });
});
