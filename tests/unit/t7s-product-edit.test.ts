import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { product: { findUnique: vi.fn(), update: vi.fn() }, project: { findMany: vi.fn(), updateMany: vi.fn() }, organization: { findUnique: vi.fn() }, activityLog: { create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@pm-collab/core/access", () => ({ getAccess: vi.fn(), projectWhere: vi.fn() }));
vi.mock("@pm-collab/core/shared/cascade", () => ({ alignToProjects: vi.fn() }));
vi.mock("@pm-collab/core/shared/enterprise", () => ({ moveProductEnterprise: vi.fn() }));
import { prisma } from "@pm-collab/db/prisma";
import { alignToProjects } from "@pm-collab/core/shared/cascade";
import { moveProductEnterprise } from "@pm-collab/core/shared/enterprise";
import { PATCH } from "@pm-collab/core/products/id";

const user = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
const admin = { ...user, globalRole: "admin" };
const body = { enterpriseId: "other", projectIds: ["p"], name: "新名称" };
describe("产品企业变更前置校验", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: "prod", enterpriseId: "mine" } as never);
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
  });
  function noWrites() {
    expect(prisma.project.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(moveProductEnterprise).not.toHaveBeenCalled();
    expect(alignToProjects).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  }
  it("非管理员调整企业返回 403 且不写入", async () => {
    expect(await PATCH(user, { id: "prod" }, body)).toEqual({ body: { error: "只有系统管理员可以调整所属企业" }, init: { status: 403 } });
    noWrites();
  });
  it("管理员指定有效企业时仍更新关联并完成转移", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ type: "enterprise" } as never);
    const response = await PATCH(admin, { id: "prod" }, body);
    expect(response).toEqual({ body: { ok: true }, init: undefined });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(moveProductEnterprise).toHaveBeenCalledWith("prod", "other", { name: "新名称" });
  });
  it("企业不存在或不是企业时返回 400 且不写入", async () => {
    for (const target of [null, { type: "department" }]) {
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce(target as never);
      expect(await PATCH(admin, { id: "prod" }, body)).toEqual({ body: { error: "所选企业不存在" }, init: { status: 400 } });
      noWrites();
    }
  });
});
