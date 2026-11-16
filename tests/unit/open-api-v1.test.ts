import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  project: { findFirst: vi.fn(), findMany: vi.fn() }, requirement: { findFirst: vi.fn(), count: vi.fn() }, bug: { findFirst: vi.fn() },
  release: { findFirst: vi.fn() }, product: { findFirst: vi.fn() }, productNode: { findFirst: vi.fn() },
  user: { count: vi.fn() }, attachment: { findMany: vi.fn() },
} }));
vi.mock("@pm-collab/core/api-tokens", () => ({ authenticateApiToken: vi.fn(), authorizeApiToken: vi.fn() }));
vi.mock("@pm-collab/core/open-api/read", () => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@pm-collab/core/requirements/root", () => ({ POST: vi.fn() }));
vi.mock("@pm-collab/core/requirements/id", () => ({ PATCH: vi.fn() }));
vi.mock("@pm-collab/core/requirements/id-status", () => ({ PATCH: vi.fn() }));
vi.mock("@pm-collab/core/requirements/id-comments", () => ({ POST: vi.fn() }));
vi.mock("@pm-collab/core/bugs/index", () => ({ POST: vi.fn() }));
vi.mock("@pm-collab/core/bugs/id", () => ({ GET: vi.fn(), PATCH: vi.fn() }));
vi.mock("@pm-collab/core/products/id", () => ({ GET: vi.fn() }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ loadRefInfo: vi.fn() }));
vi.mock("@pm-collab/core/bugs/id-status", () => ({ PATCH: vi.fn() }));
vi.mock("@pm-collab/core/bugs/id-comments", () => ({ POST: vi.fn() }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/req-stages", () => ({ getHiddenStatuses: vi.fn() }));

import { GET, PATCH, POST } from "../../apps/web/src/app/api/v1/[...path]/route";
import { authenticateApiToken, authorizeApiToken } from "@pm-collab/core/api-tokens";
import { list, detail } from "@pm-collab/core/open-api/read";
import { GET as getProduct } from "@pm-collab/core/products/id";
import { loadRefInfo } from "@pm-collab/core/docs/docs-query";
import { POST as createRequirement } from "@pm-collab/core/requirements/root";
import { PATCH as editRequirement } from "@pm-collab/core/requirements/id";
import { PATCH as editStatus } from "@pm-collab/core/requirements/id-status";
import { POST as addComment } from "@pm-collab/core/requirements/id-comments";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";
import { getHiddenStatuses } from "@pm-collab/core/shared/req-stages";

const user = { id: "u", email: "u@example.test", name: "U", globalRole: "member", apiTokenScopes: ["requirements.read", "requirements.create", "requirements.edit", "board.move"] };
const access = { userId: "u", scope: "involved", projectIds: ["p"], tenantIds: ["p"], enterpriseId: "a", orgIds: ["a"] } as const;
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const request = (path: string, body?: object) => new Request(`http://localhost/api/v1/${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateApiToken).mockResolvedValue({ ok: true, principal: { tokenId: "t", user } } as never);
  vi.mocked(authorizeApiToken).mockResolvedValue({ user, access } as never);
  vi.mocked(can).mockResolvedValue(true);
  vi.mocked(getHiddenStatuses).mockResolvedValue([]);
});

describe("v1 API 的授权和业务写入边界", () => {
  it("无效令牌使用统一错误结构", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue({ ok: false, status: 401 });
    const r = await GET(request("requirements"), ctx("requirements"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: "unauthorized", message: "令牌无效或已失效" } });
    expect(list).not.toHaveBeenCalled();
  });
  it("服务异常也使用统一错误结构且不暴露异常内容", async () => {
    vi.mocked(authenticateApiToken).mockRejectedValue(new Error("private-internal-detail"));
    const r = await GET(request("requirements"), ctx("requirements"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: { code: "internal_error", message: "服务器处理失败，请稍后重试" } });
  });
  it("scope 不足返回 403，不查询业务数据", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue(null);
    const r = await GET(request("requirements"), ctx("requirements"));
    expect(r.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
  it("列表返回分页及项目、状态筛选", async () => {
    vi.mocked(list).mockResolvedValue({ items: [{ id: "r" }], total: 31 } as never);
    const r = await GET(request("requirements?page=2&pageSize=20&projectId=p&status=req_done"), ctx("requirements"));
    expect(await r.json()).toEqual({ data: [{ id: "r" }], meta: { page: 2, pageSize: 20, total: 31 } });
    expect(list).toHaveBeenCalledWith("requirements", access, { page: 2, pageSize: 20, projectId: "p", status: "req_done" });
  });
  it("拒绝超过 100 的分页参数", async () => {
    const r = await GET(request("bugs?pageSize=101"), ctx("bugs"));
    expect(r.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
  it("分页偏移超过数据库整数范围时返回 400", async () => {
    const r = await GET(request("bugs?page=2147483647&pageSize=100"), ctx("bugs"));
    expect(r.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
  it("不可见详情返回 404", async () => {
    vi.mocked(detail).mockResolvedValue(null);
    expect((await GET(request("requirements/foreign"), ctx("requirements/foreign"))).status).toBe(404);
  });
  it("产品详情不泄露数据范围外的关联项目和需求数量", async () => {
    vi.mocked(detail).mockResolvedValue({ id: "prod" } as never);
    vi.mocked(getProduct).mockResolvedValue({ body: { product: { projectIds: ["p", "foreign"], counts: { projects: 2, requirements: 9, nodes: 1 } } }, init: undefined });
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: "p" }] as never);
    vi.mocked(prisma.requirement.count).mockResolvedValue(3);
    const r = await GET(request("products/prod"), ctx("products/prod"));
    const data = (await r.json()).data;
    expect(data.projectIds).toEqual(["p"]);
    expect(data.counts).toEqual({ projects: 1, requirements: 3, nodes: 1 });
  });
  it("文档页正文按令牌用户重新渲染引用，不返回看不到的标题快照", async () => {
    const ref = (kind: string, id: string, title: string) => `<a class="doc-ref" data-ref-kind="${kind}" data-ref-id="${id}" href="/x"><span class="doc-ref-code">C</span><span class="doc-ref-title">${title}</span><span class="doc-ref-status">S</span></a>`;
    const body = `<p>${ref("req", "rvisible", "旧标题")} ${ref("bug", "bhidden", "机密Bug标题")}</p>`;
    vi.mocked(detail).mockResolvedValue({ id: "pg", projectId: "p", body } as never);
    vi.mocked(loadRefInfo).mockResolvedValue(new Map([["req:rvisible", { title: "当前标题", code: "REQ-1", status: "进行中", tone: "info", href: "/requirements/rvisible" }]]));
    const r = await GET(request("docs/pages/pg"), ctx("docs/pages/pg"));
    expect(r.status).toBe(200);
    const html = (await r.json()).data.body as string;
    expect(loadRefInfo).toHaveBeenCalledWith([{ kind: "req", id: "rvisible" }, { kind: "bug", id: "bhidden" }], user);
    expect(html).toContain("当前标题");
    expect(html).not.toContain("旧标题");
    expect(html).not.toContain("机密Bug标题");
    expect(html).toContain("Bug已删除");
  });
  it("文档页正文没有引用时原样返回且不查引用", async () => {
    vi.mocked(detail).mockResolvedValue({ id: "pg", projectId: "p", body: "<p>正文</p>" } as never);
    const r = await GET(request("docs/pages/pg"), ctx("docs/pages/pg"));
    expect((await r.json()).data.body).toBe("<p>正文</p>");
    expect(loadRefInfo).not.toHaveBeenCalled();
  });
  it("状态和评论先验证输入，再查不可见资源", async () => {
    vi.mocked(editStatus).mockResolvedValue({ body: { error: "非法状态" }, init: { status: 400 } });
    vi.mocked(addComment).mockResolvedValue({ body: { error: "评论内容不能为空" }, init: { status: 400 } });
    expect((await PATCH(request("requirements/x/status", { status: "invalid" }), ctx("requirements/x/status"))).status).toBe(400);
    expect((await POST(request("requirements/x/comments", { body: "" }), ctx("requirements/x/comments"))).status).toBe(400);
    expect(prisma.requirement.findFirst).not.toHaveBeenCalled();
  });
  it("跨企业关联资源返回 404 且不调用写服务", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    vi.mocked(createRequirement).mockImplementation(async (_user, body, guard) => {
      const visible = await guard!({ projectId: body.projectId });
      return visible ? { body: { id: "unexpected" }, init: undefined } : { body: { error: "项目不存在" }, init: { status: 404 } };
    });
    const r = await POST(request("requirements", { title: "test", projectId: "foreign" }), ctx("requirements"));
    expect(r.status).toBe(404);
    expect(prisma.project.findFirst).toHaveBeenCalledOnce();
  });
  it("修订版本冲突返回 409 且不调用写服务", async () => {
    vi.mocked(editRequirement).mockResolvedValue({ body: { error: "内容已被其他人修改，请刷新后再保存", code: "revision_conflict" }, init: { status: 409 } });
    const r = await PATCH(request("requirements/r", { revision: 1, title: "new" }), ctx("requirements/r"));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("revision_conflict");
  });
  it("成功写入沿用服务结果并包装 data", async () => {
    vi.mocked(createRequirement).mockResolvedValue({ body: { id: "r" }, init: undefined });
    const r = await POST(request("requirements", { title: "test" }), ctx("requirements"));
    expect(await r.json()).toEqual({ data: { id: "r" } });
    expect(createRequirement).toHaveBeenCalledWith(user, { title: "test" }, expect.any(Function));
  });
});
