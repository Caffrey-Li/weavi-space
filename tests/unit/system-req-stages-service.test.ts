import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    requirement: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    activityLog: { createMany: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/shared/req-stages", () => ({
  getHiddenStatuses: vi.fn(),
  saveHiddenStatuses: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/req-stages-shared", async () => {
  const actual = await vi.importActual<typeof import("../../apps/web/src/lib/req-stages-shared")>("../../apps/web/src/lib/req-stages-shared");
  return actual;
});

import { prisma } from "@pm-collab/db/prisma";
import { getHiddenStatuses, saveHiddenStatuses } from "@pm-collab/core/shared/req-stages";
import { POST } from "@pm-collab/core/system/req-stages";

const admin = { id: "a", email: "a@example.test", name: "A", globalRole: "admin" };
const member = { id: "m", email: "m@example.test", name: "M", globalRole: "member" };

describe("需求阶段 POST 门禁与迁移校验", () => {
  beforeEach(() => vi.resetAllMocks());

  it("非管理员先 403，不读隐藏状态/不写", async () => {
    const response = await POST(member, { hidden: [] });
    expect(response).toEqual({ body: { error: "只有管理员可以配置需求阶段" }, init: { status: 403 } });
    expect(getHiddenStatuses).not.toHaveBeenCalled();
    expect(saveHiddenStatuses).not.toHaveBeenCalled();
  });

  it("新停用阶段有需求且无迁移目标时 400，不保存", async () => {
    // req_in_progress 属于锁定阶段，parseHiddenStatuses 会丢掉；用可停用的 req_done
    vi.mocked(getHiddenStatuses).mockResolvedValue([]);
    vi.mocked(prisma.requirement.groupBy).mockResolvedValue([{ status: "req_done", _count: 3 }] as never);
    const response = await POST(admin, { hidden: ["req_done"], migrate: {} });
    expect(response).toEqual({ body: { error: "「req_done」还有 3 条需求，请选择迁移到哪个阶段" }, init: { status: 400 } });
    expect(saveHiddenStatuses).not.toHaveBeenCalled();
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
  });
});
