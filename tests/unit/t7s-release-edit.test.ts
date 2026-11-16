import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { release: { findUnique: vi.fn(), updateMany: vi.fn() }, requirement: { findMany: vi.fn() }, releaseRequirement: { deleteMany: vi.fn(), create: vi.fn() }, releaseBug: { deleteMany: vi.fn(), create: vi.fn() }, activityLog: { create: vi.fn() } } }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn().mockResolvedValue(true) }));
import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { canSeeProject } from "@pm-collab/core/access";
import { PATCH } from "@pm-collab/core/releases/id";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canSeeProject).mockResolvedValue(true);
  vi.mocked(can).mockResolvedValue(true);
  vi.mocked(prisma.release.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.release.findUnique).mockResolvedValue({ id: "rel", projectId: "p", status: "frozen", kind: "normal", version: "1", revision: 3, items: [{ id: "link", requirementId: "r1" }] } as never);
});
it("冻结版本更换需求时返回 409，连同标题和 Bug 都不写入", async () => {
  const response = await PATCH(session, { id: "rel" }, { title: "新标题", requirementIds: ["r2"], bugIds: ["b1"], revision: 3 });
  expect(response).toEqual({ body: { error: "版本已冻结，需先「解除冻结」才能调整关联需求" }, init: { status: 409 } });
  expect(prisma.release.updateMany).not.toHaveBeenCalled();
  expect(prisma.releaseRequirement.deleteMany).not.toHaveBeenCalled();
  expect(prisma.releaseRequirement.create).not.toHaveBeenCalled();
  expect(prisma.releaseBug.deleteMany).not.toHaveBeenCalled();
  expect(prisma.releaseBug.create).not.toHaveBeenCalled();
  expect(prisma.activityLog.create).not.toHaveBeenCalled();
});
it("过期 revision 仍优先返回原有冲突", async () => {
  const response = await PATCH(session, { id: "rel" }, { requirementIds: ["r2"], revision: 1 });
  expect(response.init?.status).toBe(409);
  expect(response.body).toMatchObject({ code: "revision_conflict" });
  expect(prisma.release.updateMany).not.toHaveBeenCalled();
});
it("冻结版本需求集合未变时仍允许编辑标题", async () => {
  vi.mocked(prisma.release.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.requirement.findMany).mockResolvedValue([{ id: "r1" }] as never);
  const response = await PATCH(session, { id: "rel" }, { title: "新标题", requirementIds: ["r1"], revision: 3 });
  expect(response).toMatchObject({ body: { ok: true, revision: 4 } });
  expect(prisma.release.updateMany).toHaveBeenCalledTimes(1);
});
