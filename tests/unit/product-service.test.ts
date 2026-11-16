import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { product: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() }, productIntro: { upsert: vi.fn() }, activityLog: { create: vi.fn() } } }));
vi.mock("@pm-collab/core/access", () => ({ productVisible: vi.fn(), getAccess: vi.fn(), productWhere: vi.fn(), projectWhere: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/attachments", () => ({ linkAttachments: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { prisma } from "@pm-collab/db/prisma";
import { productVisible, getAccess, productWhere } from "@pm-collab/core/access";
import { can } from "@pm-collab/core/permissions";
import { GET } from "@pm-collab/core/products/id";
import { GET as list } from "@pm-collab/core/products/index";
import { PUT } from "../../apps/web/src/products/id-intro";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
const product = { id: "p", name: "Product", code: "PR", status: "maintaining", description: null, ownerId: null, enterpriseId: "mine", environments: null, projects: [], _count: { nodes: 0, requirements: 0 } };
const request = () => new Request("http://localhost", { method: "PUT", body: "{}" });
const params = { params: Promise.resolve({ id: "p" }) };

describe("产品服务的校验顺序与企业范围", () => {
  beforeEach(() => vi.resetAllMocks());
  it("未登录先于非法内容与产品查询", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await PUT(request(), params);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "未登录" });
    expect(prisma.product.count).not.toHaveBeenCalled();
  });
  it("不可见先于无权限和非法内容，不写入", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(getAccess).mockResolvedValue({} as never);
    vi.mocked(productWhere).mockReturnValue({ enterpriseId: "mine" } as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    const response = await PUT(request(), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "产品不存在" });
    expect(can).not.toHaveBeenCalled();
    expect(prisma.productIntro.upsert).not.toHaveBeenCalled();
  });
  it("按 ID 查询同企业成功，跨企业返回 404 且不泄露内容", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);
    vi.mocked(productVisible).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const visible = await GET(session, { id: "p" });
    expect(visible.body).toMatchObject({ product: { id: "p", name: "Product" } });
    expect(await GET(session, { id: "p" })).toEqual({ body: { error: "产品不存在" }, init: { status: 404 } });
  });
  it("列表查询使用企业范围", async () => {
    vi.mocked(getAccess).mockResolvedValue({} as never);
    vi.mocked(productWhere).mockReturnValue({ enterpriseId: "mine" } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    await list(session);
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: [{ enterpriseId: "mine" }] }) }));
    // 原有“我负责的”计数没有附带企业范围，记录现状供单独修复。
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { status: { not: "archived" }, ownerId: session.id } });
  });
});
