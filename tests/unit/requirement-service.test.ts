import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: { requirement: { findUnique: vi.fn(), updateMany: vi.fn() }, activityLog: { create: vi.fn() } } }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/req-stages", () => ({ getHiddenStatuses: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { requirementVisible } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { getHiddenStatuses } from "@pm-collab/core/shared/req-stages";
import { PATCH } from "@pm-collab/core/requirements/id-status";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };

describe("需求状态服务的原有校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("非法状态先返回 400，不查询需求或权限", async () => {
    const response = await PATCH(session, { id: "r" }, { status: "invalid" });
    expect(response).toEqual({ body: { error: "非法状态" }, init: { status: 400 } });
    expect(getHiddenStatuses).not.toHaveBeenCalled();
    expect(prisma.requirement.findUnique).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });

  it("阶段停用时返回 400，不查询或写入业务数据", async () => {
    vi.mocked(getHiddenStatuses).mockResolvedValue(["req_done"]);
    const response = await PATCH(session, { id: "r" }, { status: "req_done" });
    expect(response).toEqual({ body: { error: "「需求完成」阶段已停用，请选择其他阶段" }, init: { status: 400 } });
    expect(prisma.requirement.findUnique).not.toHaveBeenCalled();
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
    expect(requirementVisible).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });

  it("不在企业数据范围内先返回 404，不检查功能权限", async () => {
    vi.mocked(getHiddenStatuses).mockResolvedValue([]);
    vi.mocked(prisma.requirement.findUnique).mockResolvedValue({ id: "r", projectId: "other" } as never);
    vi.mocked(requirementVisible).mockResolvedValue(false);
    const response = await PATCH(session, { id: "r" }, { status: "req_in_progress" });
    expect(response).toEqual({ body: { error: "不存在" }, init: { status: 404 } });
    expect(requirementVisible).toHaveBeenCalledWith(session, "r");
    expect(can).not.toHaveBeenCalled();
  });
});
