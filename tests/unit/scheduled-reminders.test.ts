import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ enqueue: vi.fn(), deliver: vi.fn(), card: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { userSchedule: { findMany: mock.findMany, findUnique: mock.findUnique, updateMany: mock.updateMany, update: mock.update } } }));
vi.mock("@/lib/scheduler-queue", () => ({ enqueueReminder: mock.enqueue }));
vi.mock("@/lib/feishu-bot", () => ({ buildCard: mock.card, deliver: mock.deliver, siteUrl: vi.fn() }));
vi.mock("@pm-collab/core/access", () => ({ getAccess: vi.fn(), bugWhere: vi.fn(), requirementWhere: vi.fn() }));
vi.mock("@pm-collab/core/shared/release-plans", () => ({ loadReleasePlans: vi.fn() }));
import { enqueueDueSchedules, runDueSchedules, runQueuedSchedule, runSchedule } from "@/lib/schedules";

const now = new Date(2026, 10, 6, 9, 0); // 服务器本机时间 周五 09:00
const row = { id: "r", userId: "u", name: "提醒", kind: "text", message: "内容", channel: "both", time: "09:00", weekdays: "1,2,3,4,5", enabled: true, lastRunAt: null };
beforeEach(() => { vi.resetAllMocks(); mock.enqueue.mockResolvedValue("job"); mock.updateMany.mockResolvedValue({ count: 1 }); mock.card.mockReturnValue({ title: "提醒" }); });

describe("个人提醒扫描和重试", () => {
  it("原公开函数仍直接执行并在返回前完成发送", async () => {
    mock.findMany.mockResolvedValue([row]);
    mock.findUnique.mockResolvedValue(row);
    mock.deliver.mockResolvedValue([{ ok: true }]);
    await runDueSchedules(now);
    expect(mock.deliver).toHaveBeenCalledOnce();
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("按服务器本机时间和 60 分钟补发窗口入队，已执行及不符合的任务跳过", async () => {
    mock.findMany.mockResolvedValue([row, { ...row, id: "edge", time: "08:00" }, { ...row, id: "late", time: "07:59" }, { ...row, id: "wrong-day", weekdays: "1" }, { ...row, id: "done", lastRunAt: new Date(2026, 10, 6, 1, 0) }]);
    await enqueueDueSchedules(now);
    expect(mock.enqueue.mock.calls).toEqual([["r", now], ["edge", now]]);
    expect(mock.updateMany).not.toHaveBeenCalled();
  });
  it("发送失败会抛给队列，同一领取时间重试时可再次发送", async () => {
    mock.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, lastRunAt: now }).mockResolvedValueOnce(row);
    mock.deliver.mockResolvedValueOnce([{ ok: false, error: "发送失败" }]).mockResolvedValueOnce([{ ok: true }]);
    await expect(runQueuedSchedule("r", now.toISOString())).rejects.toThrow("发送失败");
    await runQueuedSchedule("r", now.toISOString());
    expect(mock.updateMany).toHaveBeenCalledTimes(1);
    expect(mock.deliver).toHaveBeenCalledTimes(2);
    expect(mock.update.mock.calls.map(([arg]) => arg.data.lastStatus)).toEqual(["发送失败", "已发送"]);
  });
  it("部分渠道成功时记录失败信息但不抛错重试", async () => {
    mock.findUnique.mockResolvedValue(row);
    mock.deliver.mockResolvedValue([{ channel: "webhook", ok: true }, { channel: "dm", ok: false, error: "无法私信" }]);
    await expect(runQueuedSchedule("r", now.toISOString())).resolves.toBeUndefined();
    expect(mock.deliver).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "r" }, data: { lastStatus: "无法私信" } });
  });
  it("所有可用渠道都失败时抛错重试", async () => {
    mock.findUnique.mockResolvedValue(row);
    mock.deliver.mockResolvedValue([{ channel: "webhook", ok: false, error: "群机器人失败" }, { channel: "dm", ok: false, error: "私信失败" }]);
    await expect(runQueuedSchedule("r", now.toISOString())).rejects.toThrow("群机器人失败；私信失败");
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "r" }, data: { lastStatus: "群机器人失败；私信失败" } });
  });
  it("没有可用渠道时记录提示但不抛错重试", async () => {
    mock.findUnique.mockResolvedValue(row);
    mock.deliver.mockResolvedValue([]);
    await expect(runQueuedSchedule("r", now.toISOString())).resolves.toBeUndefined();
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "r" }, data: { lastStatus: "没有可用的发送渠道：请先在「发送渠道」开启群机器人或私信" } });
  });
  it("任务删除后返回无渠道结果，不触发发送", async () => {
    mock.findUnique.mockResolvedValue(null);
    expect(await runSchedule("gone")).toMatchObject({ ok: false, hasSuccess: false, hasChannel: false });
    expect(mock.deliver).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("发送结果明确区分成功渠道和可用渠道", async () => {
    mock.findUnique.mockResolvedValue(row);
    mock.deliver.mockResolvedValueOnce([{ ok: true }, { ok: false, error: "无法私信" }]).mockResolvedValueOnce([{ ok: false, error: "失败" }]).mockResolvedValueOnce([]);
    expect(await runSchedule("r")).toMatchObject({ ok: false, hasSuccess: true, hasChannel: true });
    expect(await runSchedule("r")).toMatchObject({ ok: false, hasSuccess: false, hasChannel: true });
    expect(await runSchedule("r")).toMatchObject({ ok: false, hasSuccess: false, hasChannel: false });
  });
  it("另一次当天任务已领取时不再发送", async () => {
    mock.findUnique.mockResolvedValue({ ...row, lastRunAt: new Date(2026, 10, 6, 8, 59) });
    await runQueuedSchedule("r", now.toISOString());
    expect(mock.updateMany).not.toHaveBeenCalled();
    expect(mock.deliver).not.toHaveBeenCalled();
  });
});
