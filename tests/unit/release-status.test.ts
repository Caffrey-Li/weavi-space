import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn(), log: vi.fn(), session: vi.fn(), can: vi.fn(),
}));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { release: { findUnique: mocks.findUnique, updateMany: mocks.updateMany }, activityLog: { create: mocks.log } } }));
vi.mock("@pm-collab/core/auth", () => ({ getSession: mocks.session }));
vi.mock("@pm-collab/core/permissions", () => ({ can: mocks.can }));
import { PATCH } from "@/app/api/releases/[id]/status/route";
const params = { params: Promise.resolve({ id: "release" }) };
const request = (status: string) => new Request("http://localhost/api/releases/release/status", { method: "PATCH", body: JSON.stringify({ status }) });

describe("发版状态流转", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: "u", globalRole: "admin" });
    mocks.can.mockResolvedValue(true);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.log.mockResolvedValue({});
  });
  it.each([["planning", "frozen"], ["frozen", "planning"], ["releasing", "released"], ["cancelled", "planning"]])("允许 %s → %s", async (from, to) => {
    mocks.findUnique.mockResolvedValue({ id: "release", projectId: "p", status: from, items: [], version: "1", revision: 3 });
    expect((await PATCH(request(to), params)).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });
  it.each([["released", "planning"], ["releasing", "frozen"], ["cancelled", "released"]])("拒绝 %s → %s", async (from, to) => {
    mocks.findUnique.mockResolvedValue({ id: "release", projectId: "p", status: from, items: [], version: "1", revision: 3 });
    expect((await PATCH(request(to), params)).status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("按读到的版本号写入（乐观锁）", async () => {
    mocks.findUnique.mockResolvedValue({ id: "release", projectId: "p", status: "planning", items: [], version: "1", revision: 3 });
    await PATCH(request("frozen"), params);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "release", revision: 3 } }));
  });
  it("读完之后被别人改过：409，不写动态", async () => {
    mocks.findUnique.mockResolvedValue({ id: "release", projectId: "p", status: "planning", items: [], version: "1", revision: 3 });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(request("frozen"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("revision_conflict");
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("未登录不能变更", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PATCH(request("frozen"), params)).status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
