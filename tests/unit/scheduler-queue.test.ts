import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  construct: vi.fn(), start: vi.fn(), stop: vi.fn(), on: vi.fn(), createQueue: vi.fn(), work: vi.fn(), schedule: vi.fn(), sendAfter: vi.fn(), send: vi.fn(), executeSql: vi.fn(),
  runDue: vi.fn(), runReminder: vi.fn(), runTableScan: vi.fn(), runTable: vi.fn(), purge: vi.fn(),
  handlers: {} as Record<string, (jobs: { data: { id: string; scheduledAt: string } }[]) => Promise<void>>,
}));
vi.mock("pg-boss", () => ({ default: class {
  constructor(options: unknown) { mock.construct(options); }
  start = mock.start; stop = mock.stop; on = mock.on; createQueue = mock.createQueue; work = mock.work;
  schedule = mock.schedule; sendAfter = mock.sendAfter; send = mock.send;
  getDb() { return { executeSql: mock.executeSql }; }
} }));
vi.mock("@/lib/schedules", () => ({ enqueueDueSchedules: mock.runDue, runQueuedSchedule: mock.runReminder }));
vi.mock("@/lib/feishu-table-auto", () => ({ enqueueDueTableSync: mock.runTableScan, runQueuedTableSync: mock.runTable }));
vi.mock("@pm-collab/core/shared/lifecycle", () => ({ purgeExpiredForQueue: mock.purge }));
vi.mock("@/lib/report-send", () => ({ sendDueReports: vi.fn(async () => 0) }));
vi.mock("@pm-collab/core/agent/rules", () => ({ runDueScheduleRules: vi.fn(async () => 0) }));
vi.mock("@/lib/agent-runner", () => ({ ensureAgent: vi.fn() }));
vi.mock("@pm-collab/core/skills/updater", () => ({ autoUpdateTick: vi.fn(async () => null) }));
vi.mock("@pm-collab/core/cloud-docs/service", () => ({ runDueCloudDocSync: vi.fn(async () => 0) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { __novaBoss?: unknown }).__novaBoss;
  mock.handlers = {};
  mock.work.mockImplementation(async (name: string, handler: (jobs: { data: { id: string; scheduledAt: string } }[]) => Promise<void>) => { mock.handlers[name] = handler; return name; });
  mock.stop.mockResolvedValue(undefined);
  mock.executeSql.mockResolvedValue({ rows: [{ last_run: null }] });
  mock.send.mockResolvedValue("job");
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/example_test");
});
afterEach(() => {
  const globalQueue = globalThis as { __novaBoss?: unknown; __novaBossRetry?: ReturnType<typeof setTimeout> };
  if (globalQueue.__novaBossRetry) clearTimeout(globalQueue.__novaBossRetry);
  delete globalQueue.__novaBossRetry;
  delete globalQueue.__novaBoss;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
});

describe("pg-boss 任务队列", () => {
  it("隔离 schema、注册定时扫描和重试，同一进程只启动一次", async () => {
    const { startJobScheduler, enqueueReminder, enqueueTableSync } = await import("@/lib/scheduler-queue");
    const [first, second] = await Promise.all([startJobScheduler(), startJobScheduler()]);
    expect(first).toBe(second);
    expect(mock.construct).toHaveBeenCalledOnce();
    expect(mock.construct).toHaveBeenCalledWith(expect.objectContaining({ schema: "nova_jobs" }));
    expect(mock.start).toHaveBeenCalledOnce();
    expect(mock.createQueue).toHaveBeenCalledTimes(10);
    for (const [, options] of mock.createQueue.mock.calls) expect(options).toMatchObject({ policy: "exclusive", retryLimit: 3, retryDelay: 30, retryBackoff: true });
    expect(mock.schedule.mock.calls).toEqual([["nova-reminder-scan", "* * * * *"], ["nova-table-scan", "* * * * *"], ["nova-purge-scan", "* * * * *"], ["nova-report-scan", "* * * * *"], ["nova-agent-rule-scan", "* * * * *"], ["nova-skill-update", "23 * * * *"], ["nova-clouddoc-scan", "41 * * * *"]]);
    expect(mock.sendAfter.mock.calls).toEqual([["nova-reminder-scan", {}, {}, 5], ["nova-table-scan", {}, {}, 5], ["nova-purge-scan", {}, {}, 5], ["nova-report-scan", {}, {}, 5], ["nova-agent-rule-scan", {}, {}, 5], ["nova-skill-update", {}, {}, 60], ["nova-clouddoc-scan", {}, {}, 90]]);
    const now = new Date("2026-11-06T01:00:00Z");
    await enqueueReminder("r", now);
    await enqueueTableSync("link", now);
    expect(mock.send).toHaveBeenCalledWith("nova-reminder", { id: "r", scheduledAt: now.toISOString() }, { singletonKey: "r" });
    expect(mock.send).toHaveBeenCalledWith("nova-table-sync", { id: "link", scheduledAt: now.toISOString() }, { singletonKey: "link" });
  });
  it("工作函数传递失败给 pg-boss，清理按一小时节奏入队", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
    const { startJobScheduler } = await import("@/lib/scheduler-queue");
    await startJobScheduler();
    await mock.handlers["nova-reminder-scan"]([]);
    await mock.handlers["nova-table-scan"]([]);
    expect(mock.runDue).toHaveBeenCalledOnce();
    expect(mock.runTableScan).toHaveBeenCalledOnce();
    const jobs = [{ data: { id: "r", scheduledAt: "2026-11-06T01:00:00.000Z" } }];
    mock.runReminder.mockRejectedValueOnce(new Error("failed"));
    await expect(mock.handlers["nova-reminder"](jobs)).rejects.toThrow("failed");
    expect(mock.runReminder).toHaveBeenCalledWith("r", jobs[0].data.scheduledAt);
    mock.runTable.mockRejectedValueOnce(new Error("sync failed"));
    await expect(mock.handlers["nova-table-sync"](jobs)).rejects.toThrow("sync failed");
    mock.purge.mockRejectedValueOnce(new Error("purge failed"));
    await expect(mock.handlers["nova-purge"]([])).rejects.toThrow("purge failed");
    await mock.handlers["nova-purge-scan"]([]);
    expect(mock.send).toHaveBeenCalledWith("nova-purge", {});
    mock.send.mockClear();
    mock.executeSql.mockResolvedValueOnce({ rows: [{ last_run: new Date("2026-11-06T01:01:00Z") }] });
    await mock.handlers["nova-purge-scan"]([]);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("初始化失败后只安排一个 60 秒重试，成功后不再重复启动", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.start.mockRejectedValueOnce(new Error("offline"));
    const { startJobScheduler } = await import("@/lib/scheduler-queue");
    const first = startJobScheduler();
    expect(startJobScheduler()).toBe(first);
    await expect(first).rejects.toThrow("offline");
    expect(console.error).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mock.construct).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.construct).toHaveBeenCalledTimes(2);
    expect(mock.start).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mock.construct).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it("连续初始化失败时每次只保留一个重试，恢复后停止", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.start.mockRejectedValueOnce(new Error("offline 1")).mockRejectedValueOnce(new Error("offline 2"));
    const { startJobScheduler } = await import("@/lib/scheduler-queue");
    await expect(startJobScheduler()).rejects.toThrow("offline 1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.construct).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.construct).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("等待重试期间提前启动成功会取消旧定时器", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.start.mockRejectedValueOnce(new Error("offline"));
    const { startJobScheduler } = await import("@/lib/scheduler-queue");
    await expect(startJobScheduler()).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(1);
    await expect(startJobScheduler()).resolves.toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.construct).toHaveBeenCalledTimes(2);
  });
  it("启动失败后允许重试初始化", async () => {
    mock.start.mockRejectedValueOnce(new Error("offline"));
    const { startJobScheduler } = await import("@/lib/scheduler-queue");
    await expect(startJobScheduler()).rejects.toThrow("offline");
    expect(mock.stop).toHaveBeenCalledOnce();
    await expect(startJobScheduler()).resolves.toBeDefined();
    expect(mock.construct).toHaveBeenCalledTimes(2);
  });
});
