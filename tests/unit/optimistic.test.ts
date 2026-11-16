import { describe, expect, it } from "vitest";
import { bumpRevision } from "@/lib/revision-bump";
import { RevisionConflict, baseRevision, expectedRevision } from "@pm-collab/core/shared/optimistic";

describe("乐观锁版本号", () => {
  it("更新内容时自动 +1", () => {
    const args: Record<string, unknown> = { where: { id: "r" }, data: { title: "新标题" } };
    bumpRevision("Requirement", "update", args);
    expect(args.data).toEqual({ title: "新标题", revision: { increment: 1 } });
    const many: Record<string, unknown> = { where: {}, data: { title: "x" } };
    bumpRevision("Bug", "updateMany", many);
    expect((many.data as Record<string, unknown>).revision).toEqual({ increment: 1 });
    const up: Record<string, unknown> = { where: {}, create: {}, update: { title: "x" } };
    bumpRevision("Release", "upsert", up);
    expect((up.update as Record<string, unknown>).revision).toEqual({ increment: 1 });
  });
  it("只改不算内容的字段、或自己写了 revision 时不加", () => {
    for (const [model, data] of [
      ["Requirement", { updatedAt: new Date() }],
      ["Requirement", { status: "online", boardOrder: 1, actualEndAt: new Date() }],
      ["Bug", { status: "closed", reopenCount: { increment: 1 } }],
      ["DocPage", { viewCount: { increment: 1 } }],
      ["DocPage", { draftTitle: "t", draftBody: "b", draftUpdatedAt: new Date() }],
      ["Requirement", { title: "x", revision: 5 }],
    ] as const) {
      const args: Record<string, unknown> = { data: { ...data } };
      bumpRevision(model, "update", args);
      expect(args.data).toEqual(data);
    }
  });
  it("其他表、其他操作不动", () => {
    const args: Record<string, unknown> = { data: { name: "x" } };
    bumpRevision("User", "update", args);
    bumpRevision("Requirement", "create", args);
    expect(args.data).toEqual({ name: "x" });
  });
  it("客户端带的版本号", () => {
    expect(expectedRevision({ revision: 3 })).toBe(3);
    expect(expectedRevision({ revision: "3" })).toBeUndefined();
    expect(expectedRevision({ revision: -1 })).toBeUndefined();
    expect(expectedRevision(null)).toBeUndefined();
    expect(baseRevision({}, 7)).toBe(7);
    expect(baseRevision({ revision: 7 }, 7)).toBe(7);
    expect(() => baseRevision({ revision: 6 }, 7)).toThrow(RevisionConflict);
  });
});
