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
}));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn(async () => true), getAccess: vi.fn(), userWhere: vi.fn(() => ({})) }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(async () => true), canEditDocs: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/requirements/flow", () => ({ advanceRequirements: db.advance }));

import { reviewAction, startReview } from "@pm-collab/core/reviews/service";

const me = { id: "u1", email: "a@x", name: "甲", globalRole: "member" };
beforeEach(() => {
  vi.clearAllMocks();
  db.requirement.findFirst.mockResolvedValue({ id: "r1", title: "登录", projectId: "p1", docPageId: null, creatorId: "c", proposerId: "pp" });
  db.projectMember.findMany.mockResolvedValue([{ user: { id: "u2", name: "乙", avatarUrl: null } }, { user: { id: "u3", name: "丙", avatarUrl: null } }]);
  db.review.updateMany.mockResolvedValue({ count: 1 });
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
