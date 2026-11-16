import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { bug: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, activityLog: { create: vi.fn() } } }));
vi.mock("@pm-collab/core/access", () => ({ bugVisible: vi.fn(), getAccess: vi.fn(), bugWhere: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/lifecycle", () => ({ LifecycleError: class extends Error {}, runAction: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { prisma } from "@pm-collab/db/prisma";
import { bugVisible, getAccess, bugWhere } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { runAction } from "@pm-collab/core/shared/lifecycle";
import { PATCH } from "@pm-collab/core/bugs/id-status";
import { POST as bulkDelete } from "@pm-collab/core/bugs/bulk-delete";
import { PATCH as statusRoute } from "../../apps/web/src/bugs/id-status";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };

describe("Bug 服务保留校验顺序和数据范围", () => {
  beforeEach(() => vi.resetAllMocks());

  it("未登录先于非法状态，且不查询数据库", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await statusRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "invalid" }) }), { params: Promise.resolve({ id: "b" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "未登录" });
    expect(prisma.bug.findFirst).not.toHaveBeenCalled();
  });

  it("非法状态先于不可见和权限检查", async () => {
    expect(await PATCH(session, { id: "b" }, { status: "invalid" })).toEqual({ body: { error: "非法状态" }, init: { status: 400 } });
    expect(prisma.bug.findFirst).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });

  it("同企业可见数据成功，跨企业返回 404 且不写入", async () => {
    vi.mocked(prisma.bug.findFirst).mockResolvedValue({ id: "b", projectId: "p", status: "open" } as never);
    vi.mocked(bugVisible).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(can).mockResolvedValue(true);
    expect(await PATCH(session, { id: "b" }, { status: "open" })).toEqual({ body: { ok: true }, init: undefined });
    expect(await PATCH(session, { id: "b" }, { status: "open" })).toEqual({ body: { error: "不存在" }, init: { status: 404 } });
    expect(can).toHaveBeenCalledTimes(1);
    expect(prisma.bug.updateMany).not.toHaveBeenCalled();
  });

  it("批量删除跳过不可见的跨企业数据", async () => {
    vi.mocked(getAccess).mockResolvedValue({} as never);
    vi.mocked(bugWhere).mockReturnValue({ enterpriseId: "mine" } as never);
    vi.mocked(prisma.bug.findMany).mockResolvedValue([{ id: "mine", projectId: "p" }] as never);
    vi.mocked(can).mockResolvedValue(true);
    const response = await bulkDelete(session, { ids: ["mine", "other"] });
    expect(response.body).toEqual({ deleted: ["mine"], skipped: [{ id: "other", reason: "不存在或无权访问" }] });
    expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: [{ enterpriseId: "mine" }] }) }));
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith(session, "bug", "mine", "delete");
  });
});
