import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  requirement: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  requirementTask: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  projectMember: { findFirst: vi.fn() },
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  activityLog: { create: vi.fn(), createMany: vi.fn() },
  iteration: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  project: { findUnique: vi.fn() },
}));
const perm = vi.hoisted(() => ({ visible: true, edit: true }));
const advance = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn(async () => perm.visible), canSeeProject: vi.fn(async () => perm.visible), getAccess: vi.fn(async () => ({})), requirementWhere: vi.fn(() => ({})) }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn(async () => perm.edit) }));
vi.mock("@pm-collab/core/requirements/flow", () => ({ advanceRequirements: advance }));

import { DEFAULT_ENTERPRISE_FLOW, gateStageFor, crossesReviewGate, parseGates, resolveFlow } from "@pm-collab/core/shared/flow-config-shared";
import { findCodes, reqCodeOf, taskCodeOf } from "@pm-collab/core/shared/codes";
import { createTask, shiftTasks, splitPlan, syncRequirementStatus, updateTask } from "@pm-collab/core/requirements/tasks";
import { assignIteration, createIteration, updateIteration } from "@pm-collab/core/requirements/iterations";

const session = { id: "u1", globalRole: "member" } as never;

describe("T43 流程合成：研发模式 / 设计环节 / 关卡", () => {
  it("企业启用设计环节后「设计中」可用；项目在允许时可以关掉", () => {
    const ent = { ...DEFAULT_ENTERPRISE_FLOW, designStage: true, mode: "scrum" as const, gates: parseGates(["dev:ui", "bogus"]) };
    expect(resolveFlow([], ent, null)).toMatchObject({ hidden: [], designStage: true, mode: "scrum", gates: ["dev:ui"] });
    expect(resolveFlow([], ent, { hidden: [], reviewRequired: null, designStage: false, mode: "phase" })).toMatchObject({ hidden: ["req_design"], designStage: false, mode: "phase" });
    expect(resolveFlow([], { ...ent, allowProjectMode: false }, { hidden: [], reviewRequired: null, designStage: false, mode: "phase" })).toMatchObject({ designStage: true, mode: "scrum" });
  });
  it("项目只能加关卡，企业不允许时不生效", () => {
    const ent = { ...DEFAULT_ENTERPRISE_FLOW, gates: parseGates(["online:report"]) };
    expect(resolveFlow([], ent, { hidden: [], reviewRequired: null, gates: parseGates(["test:cases"]) }).gates.sort()).toEqual(["online:report", "test:cases"]);
    expect(resolveFlow([], { ...ent, allowProjectGates: false }, { hidden: [], reviewRequired: null, gates: parseGates(["test:cases"]) }).gates).toEqual(["online:report"]);
  });
  it("关卡段：只在往前走时检查；进入设计也过评审关", () => {
    expect(gateStageFor("req_done", "req_design")).toBe("design");
    expect(gateStageFor("req_design", "dev_todo")).toBe("dev");
    expect(gateStageFor("dev_in_progress", "test_todo")).toBe("test");
    expect(gateStageFor("test_done", "online")).toBe("online");
    expect(gateStageFor("test_todo", "dev_in_progress")).toBeNull();
    expect(gateStageFor("dev_todo", "cancelled")).toBeNull();
    expect(crossesReviewGate("req_done", "req_design")).toBe(true);
    expect(crossesReviewGate("req_in_progress", "req_done")).toBe(false);
  });
});

describe("T43 编号", () => {
  it("显示和识别", () => {
    expect(reqCodeOf({ number: 1042 })).toBe("R1042");
    expect(taskCodeOf({ number: 7 })).toBe("T7");
    expect(findCodes("feature/R1042-export fix T1562 and r1043; HR1044 不算, T15x")).toEqual({ reqs: [1042, 1043], tasks: [1562] });
  });
});

describe("T43 任务", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perm.visible = true;
    perm.edit = true;
    db.requirement.findFirst.mockResolvedValue({ id: "r1", projectId: "p1", status: "dev_todo", title: "导出", startAt: null, plannedEndAt: null, workspaceId: "ws", archivedAt: null });
    db.requirementTask.count.mockResolvedValue(0);
    db.requirementTask.create.mockImplementation(async ({ data }) => ({ id: "t1", number: 1001, ...data }));
  });
  it("负责人必须是项目成员；看不到需求 404；没权限 403", async () => {
    db.projectMember.findFirst.mockResolvedValue(null);
    expect((await createTask(session, "r1", { title: "接口", assigneeId: "x" })).init?.status).toBe(400);
    perm.edit = false;
    expect((await createTask(session, "r1", { title: "接口" })).init?.status).toBe(403);
    perm.visible = false;
    expect((await createTask(session, "r1", { title: "接口" })).init?.status).toBe(404);
  });
  it("日期顺序和类型校验", async () => {
    expect((await createTask(session, "r1", { title: "a", kind: "hack" })).init?.status).toBe(400);
    expect((await createTask(session, "r1", { title: "a", startAt: "2026-11-10", dueAt: "2026-11-01" })).init?.status).toBe(400);
    expect((await createTask(session, "r1", { title: "a", kind: "backend", startAt: "2026-11-01", dueAt: "2026-11-10" })).body).toMatchObject({ code: "T1001" });
  });
  it("负责人可以改自己任务的状态，不能改别的字段", async () => {
    perm.edit = false;
    db.requirementTask.findFirst.mockResolvedValue({ id: "t1", number: 1001, requirementId: "r1", assigneeId: "u1", status: "todo", startAt: null, dueAt: null });
    db.requirement.findUnique.mockResolvedValue({ status: "dev_todo" });
    db.requirementTask.findMany.mockResolvedValue([{ kind: "backend", status: "doing" }]);
    expect((await updateTask(session, "r1", "t1", { status: "doing" })).init).toBeUndefined();
    expect((await updateTask(session, "r1", "t1", { title: "改标题" })).init?.status).toBe(403);
  });
  it("开发任务开始 → 开发中；全部完成 → 开发完成；测试任务全部完成 → 测试完成", async () => {
    db.requirement.findUnique.mockResolvedValue({ status: "dev_todo" });
    db.requirementTask.findMany.mockResolvedValue([{ kind: "frontend", status: "doing" }, { kind: "backend", status: "todo" }]);
    await syncRequirementStatus("u1", "r1");
    expect(advance).toHaveBeenLastCalledWith("u1", ["r1"], "dev_in_progress", expect.any(String));
    db.requirement.findUnique.mockResolvedValue({ status: "dev_in_progress" });
    db.requirementTask.findMany.mockResolvedValue([{ kind: "frontend", status: "done" }, { kind: "backend", status: "done" }]);
    await syncRequirementStatus("u1", "r1");
    expect(advance).toHaveBeenLastCalledWith("u1", ["r1"], "dev_done", expect.any(String));
    db.requirement.findUnique.mockResolvedValue({ status: "test_in_progress" });
    db.requirementTask.findMany.mockResolvedValue([{ kind: "frontend", status: "done" }, { kind: "test", status: "done" }]);
    advance.mockClear();
    await syncRequirementStatus("u1", "r1");
    expect(advance).toHaveBeenCalledWith("u1", ["r1"], "test_done", expect.any(String));
  });
  it("改计划：没开始的任务按开始日的变化平移", async () => {
    db.requirementTask.findMany.mockResolvedValue([{ id: "t1", startAt: new Date("2026-11-03T00:00:00"), dueAt: new Date("2026-11-05T00:00:00") }]);
    const r = await shiftTasks("u1", "r1", { startAt: new Date("2026-11-01T00:00:00"), plannedEndAt: null }, { startAt: new Date("2026-11-03T00:00:00") });
    expect(r).toEqual({ count: 1, days: 2 });
    expect(db.requirementTask.update.mock.calls[0][0].data.startAt.getDate()).toBe(5);
    expect(await shiftTasks("u1", "r1", { startAt: null, plannedEndAt: null }, { startAt: new Date() })).toEqual({ count: 0, days: 0 });
  });
  it("按模板切分日期", () => {
    const p = splitPlan(new Date("2026-11-01T00:00:00"), new Date("2026-11-11T00:00:00"), ["design", "backend", "test", "release"]);
    expect(p.map((x) => x.due?.getDate())).toEqual([3, 7, 10, 11]);
    expect(splitPlan(null, null, ["backend"])[0]).toEqual({ start: null, due: null });
  });
});

describe("T43 迭代", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perm.visible = true;
    perm.edit = true;
    db.project.findUnique.mockResolvedValue({ workspaceId: "ws" });
    db.iteration.count.mockResolvedValue(2);
    db.iteration.create.mockImplementation(async ({ data }) => ({ id: "i3", ...data }));
  });
  it("新建：默认名、日期校验、最长两个月", async () => {
    expect((await createIteration(session, "p1", { startAt: "2026-11-17", endAt: "2026-11-28" })).body).toEqual({ id: "i3" });
    expect(db.iteration.create.mock.calls[0][0].data.name).toBe("迭代 3");
    expect((await createIteration(session, "p1", { startAt: "2026-11-28", endAt: "2026-11-17" })).init?.status).toBe(400);
    expect((await createIteration(session, "p1", { startAt: "2026-01-01", endAt: "2026-04-01" })).init?.status).toBe(400);
  });
  it("同时只能有一个进行中；完成时未完成的挪到下一期", async () => {
    db.iteration.findFirst.mockResolvedValueOnce({ id: "i2", projectId: "p1", status: "planning", name: "迭代 2" }).mockResolvedValueOnce({ id: "i1" });
    expect((await updateIteration(session, "p1", "i2", { action: "start" })).init?.status).toBe(409);
    db.iteration.findFirst.mockResolvedValueOnce({ id: "i1", projectId: "p1", status: "active", name: "迭代 1" }).mockResolvedValueOnce({ id: "i2", name: "迭代 2" });
    db.requirement.updateMany.mockResolvedValue({ count: 3 });
    expect((await updateIteration(session, "p1", "i1", { action: "complete", moveTo: "i2" })).body).toEqual({ ok: true, moved: 3 });
    expect(db.requirement.updateMany).toHaveBeenCalledWith({ where: { iterationId: "i1", status: { notIn: ["online", "cancelled"] } }, data: { iterationId: "i2" } });
  });
  it("规划只能动本项目的需求；没权限 403", async () => {
    db.iteration.findFirst.mockResolvedValue({ id: "i2", name: "迭代 2" });
    db.requirement.findMany.mockResolvedValue([{ id: "a" }]);
    expect((await assignIteration(session, "p1", { iterationId: "i2", requirementIds: ["a", "other"] })).init?.status).toBe(404);
    perm.edit = false;
    expect((await assignIteration(session, "p1", { iterationId: "i2", requirementIds: ["a"] })).init?.status).toBe(403);
  });
});

describe("T45 我的任务", () => {
  it("只查指派给我、没完成、看得到的需求里的任务", async () => {
    db.requirementTask.findMany.mockResolvedValue([{ id: "t1", number: 1001, kind: "backend", title: "接口", status: "doing", startAt: null, dueAt: null, estimate: null, requirement: { id: "r1", number: 1042, title: "导出", status: "dev_in_progress", project: { id: "p1", name: "P" } } }]);
    const { myTasks } = await import("@pm-collab/core/requirements/tasks");
    const rows = await myTasks(session, { take: 8 });
    const where = db.requirementTask.findMany.mock.calls.at(-1)![0].where;
    expect(where.assigneeId).toBe("u1");
    expect(where.status).toEqual({ in: ["todo", "doing"] });
    expect(where.requirement.AND).toBeDefined();
    expect(rows[0]).toMatchObject({ code: "T1001", requirement: { code: "R1042" } });
  });
});
