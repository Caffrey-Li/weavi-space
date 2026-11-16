import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    feishuTableLink: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    feishuTableRow: { deleteMany: vi.fn() },
    user: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/access", () => ({ getAccess: vi.fn() }));
vi.mock("@pm-collab/core/shared/feishu-table-links", () => ({
  canSeeLink: vi.fn(),
  canEditLink: vi.fn(),
  canSyncLink: vi.fn(),
  normalizeLink: vi.fn(),
  runLinkSync: vi.fn(),
  visibleLinkWhere: vi.fn(() => ({})),
}));
vi.mock("@pm-collab/core/shared/feishu-table-sync", () => ({
  asTarget: vi.fn((t: string) => t || "requirement"),
  featureFor: vi.fn(() => "requirements.create"),
  previewPull: vi.fn(),
  previewPush: vi.fn(),
  asAutoSync: vi.fn(),
  parseMappingFull: vi.fn(() => ({ autoTitle: false, multi: {} })),
  parsePushFields: vi.fn(() => []),
  serializeMapping: vi.fn(() => "{}"),
  SYNC_FIELDS: [],
  BUG_SYNC_FIELDS: [],
  MULTI_KEYS: [],
}));

import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { canSeeLink, canEditLink, canSyncLink } from "@pm-collab/core/shared/feishu-table-links";
import { getAccess } from "@pm-collab/core/access";
import { PATCH, DELETE } from "@pm-collab/core/feishu-tables/id";
import { POST as syncPost } from "@pm-collab/core/feishu-tables/id-sync";
import { GET as listLinks, POST as createLink } from "@pm-collab/core/feishu-tables/root";

const session = { id: "u1", email: "u@example.test", name: "U", globalRole: "member" };
const link = { id: "L1", visibility: "private", createdById: "other", projectId: "p1", target: "requirement", token: "t", tableId: "tb", autoSync: "off", autoEvery: 0, url: "https://feishu.cn/sheets/x" };

describe("飞书表格连接：不可见即 404，写前不解析 body", () => {
  beforeEach(() => vi.resetAllMocks());

  it("PATCH 不可见连接 404，不解析 body、不检查编辑权与 can", async () => {
    vi.mocked(prisma.feishuTableLink.findUnique).mockResolvedValue(link as never);
    vi.mocked(canSeeLink).mockReturnValue(false);
    const getBody = vi.fn(async () => ({ url: "https://feishu.cn/sheets/y" }));
    const response = await PATCH(session, { id: "L1" }, getBody);
    expect(response).toEqual({ body: { error: "连接不存在" }, init: { status: 404 } });
    expect(getBody).not.toHaveBeenCalled();
    expect(canEditLink).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
    expect(prisma.feishuTableLink.update).not.toHaveBeenCalled();
  });

  it("PATCH 可见但不可编辑：403 在 body 解析前", async () => {
    vi.mocked(prisma.feishuTableLink.findUnique).mockResolvedValue(link as never);
    vi.mocked(canSeeLink).mockReturnValue(true);
    vi.mocked(canEditLink).mockReturnValue(false);
    const getBody = vi.fn(async () => ({ name: "x" }));
    const response = await PATCH(session, { id: "L1" }, getBody);
    expect(response).toEqual({ body: { error: "只有创建人可以编辑这个连接" }, init: { status: 403 } });
    expect(getBody).not.toHaveBeenCalled();
  });

  it("DELETE 不可见 404，不删行", async () => {
    vi.mocked(prisma.feishuTableLink.findUnique).mockResolvedValue(link as never);
    vi.mocked(canSeeLink).mockReturnValue(false);
    const response = await DELETE(session, { id: "L1" });
    expect(response).toEqual({ body: { error: "连接不存在" }, init: { status: 404 } });
    expect(prisma.feishuTableRow.deleteMany).not.toHaveBeenCalled();
    expect(prisma.feishuTableLink.delete).not.toHaveBeenCalled();
  });

  it("同步 POST 不可见 404，不解析 body、不 canSync", async () => {
    vi.mocked(prisma.feishuTableLink.findUnique).mockResolvedValue(link as never);
    vi.mocked(canSeeLink).mockReturnValue(false);
    const getBody = vi.fn(async () => ({ direction: "pull", apply: true }));
    const response = await syncPost(session, { id: "L1" }, getBody);
    expect(response).toEqual({ body: { error: "连接不存在" }, init: { status: 404 } });
    expect(getBody).not.toHaveBeenCalled();
    expect(canSyncLink).not.toHaveBeenCalled();
  });
});


describe("飞书表格列表跨企业过滤与新建权限", () => {
  beforeEach(() => vi.resetAllMocks());

  it("GET 按 access.projectIds 过滤跨范围项目连接，且不下发 token", async () => {
    vi.mocked(getAccess).mockResolvedValue({ projectIds: ["p-mine"] } as never);
    vi.mocked(prisma.feishuTableLink.findMany).mockResolvedValue([
      { id: "l1", projectId: "p-mine", productId: null, createdById: "u1", target: "requirement", autoSync: "off", mapping: "{}", pushFields: "[]", visibility: "private", lastPull: null, lastPush: null, token: "SECRET" },
      { id: "l2", projectId: "p-other", productId: null, createdById: "u1", target: "requirement", autoSync: "off", mapping: "{}", pushFields: "[]", visibility: "private", lastPull: null, lastPush: null, token: "SECRET2" },
      { id: "l3", projectId: null, productId: null, createdById: "u1", target: "requirement", autoSync: "off", mapping: "{}", pushFields: "[]", visibility: "private", lastPull: null, lastPush: null, token: "SECRET3" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "U" }] as never);
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: "p-mine", name: "Mine", productId: null }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([]);
    vi.mocked(can).mockResolvedValue(true);

    const response = await listLinks(session);
    const body = response.body as { links: { id: string; token?: string }[] };
    expect(body.links.map((l) => l.id)).toEqual(["l1", "l3"]);
    expect(body.links.every((l) => l.token === undefined)).toBe(true);
  });

  it("POST 无建需求权限先 403，不写库", async () => {
    vi.mocked(can).mockResolvedValue(false);
    const response = await createLink(session, { url: "https://feishu.cn/x", target: "requirement" } as never);
    expect(response).toEqual({ body: { error: "无权限：需要新建需求的权限" }, init: { status: 403 } });
    expect(prisma.feishuTableLink.create).not.toHaveBeenCalled();
  });
});
