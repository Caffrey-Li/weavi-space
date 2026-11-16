import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { release: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } } }));
vi.mock("@pm-collab/core/access", () => ({ canSeeProject: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/releases/schedule", () => ({ hotfixBugCandidates: vi.fn().mockResolvedValue([]), suggestHotfixVersion: vi.fn().mockReturnValue("1.0.1") }));

import { getSession } from "@pm-collab/core/auth";
import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { PATCH } from "@pm-collab/core/releases/id-status";
import { GET } from "@pm-collab/core/releases/index";
import { GET as hotfixGet } from "@pm-collab/core/releases/hotfix";
import { hotfixBugCandidates, suggestHotfixVersion } from "@pm-collab/core/releases/schedule";
import { PATCH as statusRoute } from "../../apps/web/src/releases/id-status";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };

describe("发版服务原有校验顺序和范围", () => {
  beforeEach(() => vi.resetAllMocks());
  it("未登录优先于非法状态", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await statusRoute(new Request("http://localhost", { method: "PATCH", body: '{"status":"bad"}' }), { params: Promise.resolve({ id: "r" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "未登录" });
    expect(prisma.release.findUnique).not.toHaveBeenCalled();
  });
  it("非法状态先于查询和权限判断", async () => {
    expect(await PATCH(session, { id: "r" }, { status: "bad" })).toEqual({ body: { error: "非法状态" }, init: { status: 400 } });
    expect(prisma.release.findUnique).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });
  it("同企业成功，权限拒绝时按原约定返回 403 且不写入", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(true);
    vi.mocked(prisma.release.findUnique).mockResolvedValue({ id: "r", projectId: "p", status: "planning", items: [] } as never);
    vi.mocked(can).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await PATCH(session, { id: "r" }, { status: "planning" })).toEqual({ body: { ok: true, synced: 0 }, init: undefined });
    expect(await PATCH(session, { id: "r" }, { status: "planning" })).toEqual({ body: { error: "无权限管理发版" }, init: { status: 403 } });
    expect(prisma.release.updateMany).not.toHaveBeenCalled();
  });
  it("不可见项目的发版改状态返回 404，不检查功能权限也不写入", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(false);
    vi.mocked(prisma.release.findUnique).mockResolvedValue({ id: "r", projectId: "foreign", status: "planning", items: [] } as never);
    expect(await PATCH(session, { id: "r" }, { status: "frozen" })).toEqual({ body: { error: "不存在" }, init: { status: 404 } });
    expect(can).not.toHaveBeenCalled();
    expect(prisma.release.updateMany).not.toHaveBeenCalled();
  });
  it("紧急发版准备数据对可见项目成功，不可见项目返回 404", async () => {
    vi.mocked(canSeeProject).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(prisma.release.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.release.findMany).mockResolvedValue([]);
    vi.mocked(hotfixBugCandidates).mockResolvedValue([]);
    vi.mocked(suggestHotfixVersion).mockReturnValue("1.0.1");
    expect((await hotfixGet(session, "mine")).body).toEqual({ suggestedVersion: "1.0.1", baseVersion: null, bugs: [] });
    expect(await hotfixGet(session, "other")).toEqual({ body: { error: "项目不存在" }, init: { status: 404 } });
    expect(prisma.release.findMany).toHaveBeenCalledTimes(1);
  });
  it("列表对不可见项目返回空数组且不查发版", async () => {
    vi.mocked(canSeeProject).mockResolvedValue(false);
    expect(await GET(session, "other")).toEqual({ body: { items: [] }, init: undefined });
    expect(prisma.release.findMany).not.toHaveBeenCalled();
  });
});
