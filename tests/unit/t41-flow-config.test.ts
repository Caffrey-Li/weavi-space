import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flowConfig: { findUnique: vi.fn(), findMany: vi.fn(async () => []), upsert: vi.fn(), deleteMany: vi.fn() },
  project: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  requirement: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []), updateMany: vi.fn() },
  review: { count: vi.fn(async () => 0) },
  activityLog: { create: vi.fn(), createMany: vi.fn() },
  systemSetting: { findUnique: vi.fn(async () => null) },
  entAdmin: vi.fn(async (): Promise<string | null> => null),
  entOf: vi.fn(async (): Promise<string> => ""),
  can: vi.fn(async () => true),
  see: vi.fn(async () => true),
}));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: db.see, getAccess: vi.fn(async () => ({})), projectWhere: vi.fn(() => ({})) }));
vi.mock("@pm-collab/core/permissions", () => ({ can: db.can }));
vi.mock("@pm-collab/core/shared/enterprise-admin", () => ({ enterpriseAdminOf: db.entAdmin }));
vi.mock("@pm-collab/core/shared/role-ceiling", () => ({ enterpriseOfUserId: db.entOf }));
vi.mock("@pm-collab/core/shared/org", () => ({
  listOrgs: vi.fn(async () => [
    { id: "entA", name: "甲企业", type: "enterprise", parentId: "org_nova_collab", sortOrder: 0 },
    { id: "entB", name: "乙企业", type: "enterprise", parentId: "org_nova_collab", sortOrder: 1 },
  ]),
  subtreeIds: vi.fn((_o: unknown, id: string) => [id]),
}));

import { crossesReviewGate, labelConflict, parseLabels, resolveFlow, DEFAULT_ENTERPRISE_FLOW } from "@pm-collab/core/shared/flow-config-shared";
import { checkStatusChange, autoTarget, enterpriseGET, enterprisePUT, projectPUT } from "@pm-collab/core/flow/service";

const member = { id: "u1", email: "a@x", name: "甲", globalRole: "member" };
const admin = { id: "sa", email: "s@x", name: "超管", globalRole: "admin" };
const entRow = (o: Record<string, unknown>) => ({ hiddenStatuses: "[]", statusLabels: "{}", reviewRequired: false, allowProjectStages: true, allowProjectReview: true, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  db.flowConfig.findUnique.mockResolvedValue(null);
  db.project.findUnique.mockResolvedValue({ enterpriseId: "entA" });
  db.entAdmin.mockResolvedValue(null);
  db.entOf.mockResolvedValue("entA");
  db.review.count.mockResolvedValue(0);
  db.can.mockResolvedValue(true);
  db.see.mockResolvedValue(true);
});

describe("T41 流程合成（纯函数）", () => {
  it("没有任何配置 = 默认流程：沿用系统停用、不强制评审", () => {
    expect(resolveFlow(["req_done"], { ...DEFAULT_ENTERPRISE_FLOW }, null)).toEqual({ hidden: ["req_done", "req_design"], labels: {}, reviewRequired: false, reviewSource: "enterprise", mode: "kanban", designStage: false, gates: [] });
  });
  it("停用逐层收紧，项目不能重新启用企业停用的状态", () => {
    const f = resolveFlow([], { ...DEFAULT_ENTERPRISE_FLOW, hidden: ["dev_done"] }, { hidden: ["test_done"], reviewRequired: null });
    // T43：没启用设计环节时「设计中」也算停用
    expect(f.hidden.sort()).toEqual(["dev_done", "req_design", "test_done"]);
  });
  it("企业不允许时项目的覆盖不生效", () => {
    const ent = { ...DEFAULT_ENTERPRISE_FLOW, reviewRequired: true, allowProjectReview: false, allowProjectStages: false };
    const f = resolveFlow([], ent, { hidden: ["test_done"], reviewRequired: false });
    expect(f.reviewRequired).toBe(true);
    expect(f.hidden).toEqual(["req_design"]);
  });
  it("企业允许时项目可以关掉评审", () => {
    expect(resolveFlow([], { ...DEFAULT_ENTERPRISE_FLOW, reviewRequired: true }, { hidden: [], reviewRequired: false })).toMatchObject({ reviewRequired: false, reviewSource: "project" });
  });
  it("必须保留的状态不能停用", () => {
    expect(resolveFlow([], { ...DEFAULT_ENTERPRISE_FLOW, hidden: ["req_in_progress", "online", "cancelled"] }, null).hidden).toEqual(["req_design"]);
  });
  it("评审关只拦从需求阶段往后推", () => {
    expect(crossesReviewGate("req_in_progress", "dev_todo")).toBe(true);
    expect(crossesReviewGate("req_done", "online")).toBe(true);
    expect(crossesReviewGate("req_in_progress", "req_done")).toBe(false);
    expect(crossesReviewGate("req_in_progress", "cancelled")).toBe(false);
    expect(crossesReviewGate("dev_todo", "test_todo")).toBe(false);
  });
  it("显示名称：去掉未知 key 和默认名，名称不能重复", () => {
    expect(parseLabels({ req_in_progress: " 方案设计 ", foo: "x", online: "已上线" })).toEqual({ req_in_progress: "方案设计" });
    expect(labelConflict({ req_done: "需求中" })).toMatch("需求中");
    expect(labelConflict({ req_done: "方案评审" })).toBeNull();
  });
});

describe("T41 改状态时生效", () => {
  const req = { id: "r1", projectId: "p1", creatorId: "c", docPageId: null, status: "req_in_progress" };
  it("默认流程不拦", async () => {
    expect(await checkStatusChange(req, "dev_todo")).toBeNull();
  });
  it("企业要求评审、没有通过的评审时拦住", async () => {
    db.flowConfig.findUnique.mockImplementation(async ({ where }: { where: { scope_scopeId: { scope: string } } }) => (where.scope_scopeId.scope === "enterprise" ? entRow({ reviewRequired: true }) : null));
    expect(await checkStatusChange(req, "dev_todo")).toMatch("评审");
    expect(await checkStatusChange(req, "req_done")).toBeNull();
    db.review.count.mockResolvedValue(1);
    expect(await checkStatusChange(req, "dev_todo")).toBeNull();
  });
  it("项目停用的状态不能选", async () => {
    db.flowConfig.findUnique.mockImplementation(async ({ where }: { where: { scope_scopeId: { scope: string } } }) => (where.scope_scopeId.scope === "project" ? { hiddenStatuses: '["dev_done"]', reviewRequired: null } : null));
    expect(await checkStatusChange({ ...req, status: "dev_in_progress" }, "dev_done")).toMatch("已停用");
  });
  it("自动推进：没评审通过不离开需求阶段；停用的目标顺延", async () => {
    db.flowConfig.findUnique.mockImplementation(async ({ where }: { where: { scope_scopeId: { scope: string } } }) => (where.scope_scopeId.scope === "enterprise" ? entRow({ reviewRequired: true, hiddenStatuses: '["test_done"]' }) : null));
    expect(await autoTarget(req, "dev_todo")).toBeNull();
    expect(await autoTarget({ ...req, status: "test_in_progress" }, "test_done")).toBe("online");
  });
});

describe("T41 多租户", () => {
  it("普通成员读别的企业按不存在", async () => {
    expect((await enterpriseGET(member, "entB")).init?.status).toBe(404);
  });
  it("普通成员只读本企业、不能改", async () => {
    const r = await enterpriseGET(member, null);
    expect(r.body).toMatchObject({ enterpriseId: "entA", canEdit: false });
    expect((await enterprisePUT(member, { reviewRequired: true })).init?.status).toBe(403);
  });
  it("企业超管改不了别的企业", async () => {
    db.entAdmin.mockResolvedValue("entA");
    expect((await enterprisePUT(member, { enterpriseId: "entB", reviewRequired: true })).init?.status).toBe(404);
    expect(db.flowConfig.upsert).not.toHaveBeenCalled();
  });
  it("企业超管改本企业；停用有需求的状态要给迁移目标", async () => {
    db.entAdmin.mockResolvedValue("entA");
    db.requirement.groupBy.mockResolvedValue([{ status: "dev_done", _count: 3 }] as never);
    expect((await enterprisePUT(member, { hidden: ["dev_done"] })).init?.status).toBe(400);
    const ok = await enterprisePUT(member, { hidden: ["dev_done"], migrate: { dev_done: "test_todo" }, reviewRequired: true });
    expect(ok.body).toMatchObject({ ok: true, migrated: [{ from: "dev_done", to: "test_todo", count: 3 }] });
    expect(db.flowConfig.upsert.mock.calls[0][0].create).toMatchObject({ scope: "enterprise", scopeId: "entA", reviewRequired: true });
  });
  it("系统超管可以改任意企业", async () => {
    expect((await enterprisePUT(admin, { enterpriseId: "entB", reviewRequired: true })).body).toMatchObject({ ok: true });
  });
  it("看不到的项目按不存在；企业不允许时项目不能改评审", async () => {
    db.see.mockResolvedValue(false);
    expect((await projectPUT(member, "p9", { reviewRequired: false })).init?.status).toBe(404);
    db.see.mockResolvedValue(true);
    db.flowConfig.findUnique.mockImplementation(async ({ where }: { where: { scope_scopeId: { scope: string } } }) => (where.scope_scopeId.scope === "enterprise" ? entRow({ reviewRequired: true, allowProjectReview: false }) : null));
    expect((await projectPUT(member, "p1", { reviewRequired: false })).init?.status).toBe(403);
  });
  it("没有编辑项目权限不能改项目流程", async () => {
    db.can.mockResolvedValue(false);
    expect((await projectPUT(member, "p1", { reviewRequired: true })).init?.status).toBe(403);
  });
});
