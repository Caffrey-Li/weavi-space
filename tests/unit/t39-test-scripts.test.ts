import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  requirement: { findUnique: vi.fn() },
  delivery: { findMany: vi.fn(), update: vi.fn() },
  deliveryRun: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
  docPage: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  notification: { create: vi.fn() },
  project: { findUnique: vi.fn() },
}));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canEditDocs: vi.fn(async () => true), canViewSpace: vi.fn(async () => true), bugCodeOf: vi.fn() }));
vi.mock("@pm-collab/core/requirements/flow", () => ({ advanceRequirements: vi.fn(), deliveryRequirements: vi.fn(async () => ({ owners: [], kids: [] })) }));
vi.mock("@pm-collab/core/delivery/runner", () => ({ kickRunner: vi.fn() }));

import { cleanScripts, onRequirementReadyForTest } from "@pm-collab/core/delivery/testing";

describe("T39 自定义测试脚本校验", () => {
  it("接受常见脚本", () => expect(cleanScripts([{ name: "login.spec.ts", content: "test()" }, { name: "cases.yaml", content: "a: 1" }])).toHaveLength(2));
  it.each([["../x.ts"], [".env"], ["a/b.ts"], ["run.sh"], ["x.exe"], [""]])("拒绝文件名 %s", (name) => expect(() => cleanScripts([{ name, content: "" }])).toThrow());
  it("数量、大小、重名", () => {
    expect(() => cleanScripts(Array.from({ length: 11 }, (_, i) => ({ name: `a${i}.ts`, content: "" })))).toThrow();
    expect(() => cleanScripts([{ name: "a.ts", content: "x".repeat(200_001) }])).toThrow();
    expect(() => cleanScripts([{ name: "a.ts", content: "" }, { name: "a.ts", content: "" }])).toThrow();
  });
});

describe("T39 提测自动执行", () => {
  const delivery = { id: "d1", projectId: "p1", sourcePageId: "doc1", featureReqs: { "F-01": "r2" }, autoRun: "server", autoRunById: "u1", casesStatus: "confirmed", casesPageId: "cases", envUrl: "https://test.example.com", envName: "测试" };
  beforeEach(() => {
    vi.clearAllMocks();
    db.requirement.findUnique.mockResolvedValue({ id: "r1", title: "登录", docPageId: "doc1" });
    db.delivery.findMany.mockResolvedValue([delivery]);
    db.deliveryRun.findFirst.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: "u1", email: "a@x", name: "甲", globalRole: "member", avatarUrl: null, isActive: true, isDemo: false });
    db.project.findUnique.mockResolvedValue({ product: { name: "P", environments: JSON.stringify([{ name: "测试", urls: [{ url: "https://test.example.com" }] }]) } });
    db.docPage.findUnique.mockResolvedValue({ body: JSON.stringify({ cases: [{ code: "TC-01", title: "登录", priority: "P0", mode: "auto", steps: [{ action: "goto", target: "/" }] }] }) });
    db.deliveryRun.aggregate.mockResolvedValue({ _max: { round: 1 } });
    db.deliveryRun.create.mockResolvedValue({ id: "run1" });
  });
  it("主文档对应的需求进入待测试：以开启人身份发起一轮并通知", async () => {
    expect(await onRequirementReadyForTest("r1")).toBe(1);
    expect(db.deliveryRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryId: "d1", kind: "round", round: 2, executor: "server", createdById: "u1" }) }));
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1" }) }));
  });
  it("PRD 拆出的实现需求也能触发", async () => {
    db.requirement.findUnique.mockResolvedValue({ id: "r2", title: "子", docPageId: null });
    expect(await onRequirementReadyForTest("r2")).toBe(1);
  });
  it("无关的需求、已有进行中的一轮、开启人停用时不发起", async () => {
    db.requirement.findUnique.mockResolvedValueOnce({ id: "r9", title: "无关", docPageId: "other" });
    expect(await onRequirementReadyForTest("r9")).toBe(0);
    db.deliveryRun.findFirst.mockResolvedValueOnce({ id: "active" });
    expect(await onRequirementReadyForTest("r1")).toBe(0);
    db.user.findUnique.mockResolvedValueOnce({ id: "u1", isActive: false, isDemo: false });
    expect(await onRequirementReadyForTest("r1")).toBe(0);
    expect(db.deliveryRun.create).not.toHaveBeenCalled();
  });
});
