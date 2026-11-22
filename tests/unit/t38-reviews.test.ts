import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  review: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  reviewVote: { update: vi.fn() },
  requirement: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  docPage: { findFirst: vi.fn(), updateMany: vi.fn() },
  projectMember: { findMany: vi.fn() },
  notification: { createMany: vi.fn() },
  activityLog: { create: vi.fn() },
  advance: vi.fn(),
  flow: { reviewRequired: true },
  reviewers: [{ id: "u2", name: "乙", avatarUrl: null }] as { id: string; name: string; avatarUrl: string | null }[],
}));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn(async () => true), getAccess: vi.fn(), userWhere: vi.fn(() => ({})) }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(async () => true), canEditDocs: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/requirements/flow", () => ({ advanceRequirements: db.advance }));
vi.mock("@pm-collab/core/flow/service", () => ({ flowForProject: vi.fn(async () => db.flow), flowForRequirement: vi.fn(async () => db.flow), reviewersFor: vi.fn(async () => db.reviewers) }));

import { reviewAction, startReview } from "@pm-collab/core/reviews/service";

const me = { id: "u1", email: "a@x", name: "甲", globalRole: "member" };
beforeEach(() => {
  vi.clearAllMocks();
  db.requirement.findFirst.mockResolvedValue({ id: "r1", title: "登录", projectId: "p1", docPageId: null, creatorId: "c", proposerId: "pp" });
  db.projectMember.findMany.mockResolvedValue([{ user: { id: "u2", name: "乙", avatarUrl: null } }, { user: { id: "u3", name: "丙", avatarUrl: null } }]);
  db.review.updateMany.mockResolvedValue({ count: 1 });
  db.flow = { reviewRequired: true };
  db.reviewers = [{ id: "u2", name: "乙", avatarUrl: null }];
});

describe("T54 评审配置", () => {
  it("没启用评审不能发起", async () => {
    db.flow = { reviewRequired: false };
    expect((await startReview(me, { requirementId: "r1", reviewerIds: ["u2"] })).init?.status).toBe(400);
  });
  it("启用了但没配评审人不能发起", async () => {
    db.reviewers = [];
    expect((await startReview(me, { requirementId: "r1", reviewerIds: ["u2"] })).body).toMatchObject({ error: expect.stringContaining("还没有配置评审人") });
  });
  it("配置的评审人自动带上，并记第几轮", async () => {
    db.review.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ round: 2 });
    db.review.create.mockResolvedValue({ id: "rv" });
    await startReview(me, { requirementId: "r1", reviewerIds: ["u3"] });
    const data = db.review.create.mock.calls[0][0].data;
    expect(data.round).toBe(3);
    expect(data.votes.create.map((v: { userId: string }) => v.userId)).toEqual(["u2", "u3"]);
  });
});

describe("T38 发起评审", () => {
  it("评审人必须是项目成员", async () => {
    const r = await startReview(me, { requirementId: "r1", reviewerIds: ["outsider"] });
    expect(r.init?.status).toBe(400);
    expect(db.review.create).not.toHaveBeenCalled();
  });
  it("已有进行中的评审时 409", async () => {
    db.review.findFirst.mockResolvedValue({ id: "old" });
    expect((await startReview(me, { requirementId: "r1", reviewerIds: ["u2"] })).init?.status).toBe(409);
  });
  it("发起后通知评审人（不通知自己）", async () => {
    db.review.findFirst.mockResolvedValue(null);
    db.review.create.mockResolvedValue({ id: "rv" });
    const r = await startReview(me, { requirementId: "r1", reviewerIds: ["u2", "u1"].filter((x) => x !== "u1"), dueAt: "2030-01-02" });
    expect(r.body).toEqual({ id: "rv" });
    expect(db.notification.createMany.mock.calls[0][0].data.map((d: { userId: string }) => d.userId)).toEqual(["u2"]);
  });
  it("截止日期格式不对 400", async () => {
    expect((await startReview(me, { requirementId: "r1", reviewerIds: ["u2"], dueAt: "明天" })).init?.status).toBe(400);
  });
});

describe("T38 给结论", () => {
  const open = (votes: { id: string; userId: string; verdict: string }[]) => ({ id: "rv", requirementId: "r1", docPageId: null, status: "open", title: "评审：登录", createdById: "u1", votes });
  it("不是评审人 403", async () => {
    db.review.findUnique.mockResolvedValue(open([{ id: "v2", userId: "u2", verdict: "pending" }]));
    expect((await reviewAction(me, "rv", { action: "vote", verdict: "approve" })).init?.status).toBe(403);
  });
  it("有条件通过要写条件", async () => {
    db.review.findUnique.mockResolvedValue(open([{ id: "v1", userId: "u1", verdict: "pending" }]));
    expect((await reviewAction(me, "rv", { action: "vote", verdict: "conditional" })).init?.status).toBe(400);
  });
  it("还有人没评时保持评审中", async () => {
    db.review.findUnique.mockResolvedValue(open([{ id: "v1", userId: "u1", verdict: "pending" }, { id: "v2", userId: "u2", verdict: "pending" }]));
    expect((await reviewAction(me, "rv", { action: "vote", verdict: "approve" })).body).toEqual({ ok: true, status: "open" });
    expect(db.advance).not.toHaveBeenCalled();
  });
  it("最后一人通过：评审通过并推进需求", async () => {
    db.review.findUnique.mockResolvedValue(open([{ id: "v1", userId: "u1", verdict: "pending" }, { id: "v2", userId: "u2", verdict: "conditional" }]));
    expect((await reviewAction(me, "rv", { action: "vote", verdict: "approve" })).body).toEqual({ ok: true, status: "approved" });
    expect(db.advance).toHaveBeenCalledWith("u1", ["r1"], "req_done", "需求评审通过");
  });
  it("不通过立即退回，不推进需求", async () => {
    db.review.findUnique.mockResolvedValue(open([{ id: "v1", userId: "u1", verdict: "pending" }, { id: "v2", userId: "u2", verdict: "pending" }]));
    expect((await reviewAction(me, "rv", { action: "vote", verdict: "reject", comment: "缺流程" })).body).toEqual({ ok: true, status: "rejected" });
    expect(db.advance).not.toHaveBeenCalled();
    expect(db.notification.createMany).toHaveBeenCalled();
  });
});

describe("T54 催办与条件落实", () => {
  const rv = (over: Record<string, unknown>) => ({ id: "rv", requirementId: "r1", docPageId: null, status: "open", title: "评审：登录", createdById: "u1", remindedAt: null, dueAt: null, votes: [], ...over });
  it("催办只通知还没评的人，1 小时内不重复", async () => {
    db.review.findUnique.mockResolvedValue(rv({ votes: [{ id: "v2", userId: "u2", verdict: "pending" }, { id: "v3", userId: "u3", verdict: "approve" }] }));
    (db.review as unknown as { update: unknown }).update = vi.fn();
    expect((await reviewAction(me, "rv", { action: "remind" })).body).toMatchObject({ reminded: 1 });
    expect(db.notification.createMany.mock.calls[0][0].data.map((d: { userId: string }) => d.userId)).toEqual(["u2"]);
    db.review.findUnique.mockResolvedValue(rv({ remindedAt: new Date(), votes: [{ id: "v2", userId: "u2", verdict: "pending" }] }));
    expect((await reviewAction(me, "rv", { action: "remind" })).init?.status).toBe(429);
  });
  it("评审通过后可以标记有条件通过的条件已落实", async () => {
    db.review.findUnique.mockResolvedValue(rv({ status: "approved", votes: [{ id: "v2", userId: "u2", verdict: "conditional", comment: "补异常分支" }] }));
    expect((await reviewAction(me, "rv", { action: "resolve", userId: "u2", note: "已补 4.3" })).body).toEqual({ ok: true, status: "approved" });
    expect(db.reviewVote.update.mock.calls[0][0].data).toMatchObject({ resolvedById: "u1", resolvedNote: "已补 4.3" });
    expect((await reviewAction(me, "rv", { action: "resolve", userId: "u9" })).init?.status).toBe(404);
  });
});
