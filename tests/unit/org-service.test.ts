import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { groupBy: vi.fn(), updateMany: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/org", () => ({
  SYSTEM_ORG_ID: "org_system",
  listOrgs: vi.fn(),
  validParentType: vi.fn(),
  visibleOrgs: vi.fn((orgs: unknown) => orgs),
  canEditOrg: vi.fn(),
  subtreeIds: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/admin-gate", () => ({ userScope: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { listOrgs, validParentType, canEditOrg, SYSTEM_ORG_ID } from "@pm-collab/core/shared/org";
import { userScope } from "@pm-collab/core/shared/admin-gate";
import { POST as postOrg } from "@pm-collab/core/orgs/root";
import { PATCH as patchOrg } from "@pm-collab/core/orgs/id";

const session = { id: "u1", email: "u@example.test", name: "U", globalRole: "admin" };

describe("POST /api/orgs 原有校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("名称缺失先返回 400，不调用 listOrgs / can / 写库", async () => {
    const response = await postOrg(session, { name: "  ", type: "department", parentId: "p" });
    expect(response).toEqual({ body: { error: "名称必填" }, init: { status: 400 } });
    expect(listOrgs).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("类型非法先返回 400，不调用 listOrgs / can", async () => {
    const response = await postOrg(session, { name: "研发", type: "workspace", parentId: "p" });
    expect(response).toEqual({ body: { error: "只能新建企业或部门" }, init: { status: 400 } });
    expect(listOrgs).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });

  it("上级不存在返回 404，不检查 can", async () => {
    vi.mocked(listOrgs).mockResolvedValue([]);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    const response = await postOrg(session, { name: "研发", type: "department", parentId: "missing" });
    expect(response).toEqual({ body: { error: "上级组织不存在" }, init: { status: 404 } });
    expect(listOrgs).toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("父类型不合法先返回 400，不检查 can", async () => {
    vi.mocked(listOrgs).mockResolvedValue([]);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "p", type: "system" } as never);
    vi.mocked(validParentType).mockReturnValue(false);
    const response = await postOrg(session, { name: "某企", type: "enterprise", parentId: "p" });
    expect(response).toEqual({ body: { error: "企业只能建在 Weavi Space 下" }, init: { status: 400 } });
    expect(validParentType).toHaveBeenCalledWith("enterprise", "system");
    expect(can).not.toHaveBeenCalled();
  });

  it("无 users.manage 返回 403，不查 scope / 同名 / 写库", async () => {
    vi.mocked(listOrgs).mockResolvedValue([]);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "p", type: "enterprise" } as never);
    vi.mocked(validParentType).mockReturnValue(true);
    vi.mocked(can).mockResolvedValue(false);
    const response = await postOrg(session, { name: "研发", type: "department", parentId: "p" });
    expect(response).toEqual({ body: { error: "无权限管理组织" }, init: { status: 403 } });
    expect(userScope).not.toHaveBeenCalled();
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("有权限但 scope 不含父组织时返回 403，不查同名 / 写库", async () => {
    vi.mocked(listOrgs).mockResolvedValue([]);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "p", type: "enterprise" } as never);
    vi.mocked(validParentType).mockReturnValue(true);
    vi.mocked(can).mockResolvedValue(true);
    vi.mocked(userScope).mockResolvedValue(new Set(["other"]));
    const response = await postOrg({ ...session, globalRole: "manager" }, { name: "研发", type: "department", parentId: "p" });
    expect(response).toEqual({ body: { error: "只能在自己管理的组织下新建部门" }, init: { status: 403 } });
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/orgs/[id] 原有校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("组织不存在先返回 404，不检查 can", async () => {
    vi.mocked(listOrgs).mockResolvedValue([]);
    const response = await patchOrg(session, { id: "missing" }, { name: "新名" });
    expect(response).toEqual({ body: { error: "组织不存在" }, init: { status: 404 } });
    expect(can).not.toHaveBeenCalled();
  });

  it("系统组织不能修改，先于字段校验与 can", async () => {
    vi.mocked(listOrgs).mockResolvedValue([{ id: SYSTEM_ORG_ID, name: "Nova", type: "system", parentId: null, sortOrder: 0 }]);
    const response = await patchOrg(session, { id: SYSTEM_ORG_ID }, { name: "改名" });
    expect(response).toEqual({ body: { error: "系统组织不能修改" }, init: { status: 400 } });
    expect(can).not.toHaveBeenCalled();
  });

  it("空更新字段先返回 400，不检查 can", async () => {
    vi.mocked(listOrgs).mockResolvedValue([{ id: "d1", name: "研发", type: "department", parentId: "e1", sortOrder: 0 }]);
    const response = await patchOrg(session, { id: "d1" }, {});
    expect(response).toEqual({ body: { error: "无更新字段" }, init: { status: 400 } });
    expect(can).not.toHaveBeenCalled();
  });

  it("名称校验通过后无权限返回 403，不写库", async () => {
    vi.mocked(listOrgs).mockResolvedValue([{ id: "d1", name: "研发", type: "department", parentId: "e1", sortOrder: 0 }]);
    vi.mocked(can).mockResolvedValue(false);
    const response = await patchOrg(session, { id: "d1" }, { name: "新研发" });
    expect(response).toEqual({ body: { error: "无权限管理组织" }, init: { status: 403 } });
    expect(canEditOrg).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
