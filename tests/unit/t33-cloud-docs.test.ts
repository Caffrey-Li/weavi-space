import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  linkFindMany: vi.fn(), linkClaim: vi.fn(), linkUpdate: vi.fn(), user: vi.fn(), canView: vi.fn(), canEdit: vi.fn(), listDocs: vi.fn(), activity: vi.fn(),
}));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    cloudDocLink: { findMany: mock.linkFindMany, updateMany: mock.linkClaim, update: mock.linkUpdate },
    user: { findUnique: mock.user },
    activityLog: { create: mock.activity },
  },
}));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: mock.canView, canEditDocs: mock.canEdit }));
vi.mock("@pm-collab/core/cloud-docs/feishu-docx", async (orig) => ({ ...(await orig<typeof import("@pm-collab/core/cloud-docs/feishu-docx")>()), listSourceDocs: mock.listDocs }));

import { blocksToHtml, imageTokens } from "@pm-collab/core/cloud-docs/feishu-docx";
import { runDueCloudDocSync } from "@pm-collab/core/cloud-docs/service";

const run = (content: string) => ({ elements: [{ text_run: { content } }] });

describe("T33 块转 HTML：按父子结构", () => {
  it("表格单元格的内容只在表格里出现一次，表头用 th", () => {
    const html = blocksToHtml([
      { block_id: "p", block_type: 1, children: ["t", "after"] },
      { block_id: "t", block_type: 31, parent_id: "p", children: ["c1", "c2", "c3", "c4"], table: { cells: ["c1", "c2", "c3", "c4"], property: { row_size: 2, column_size: 2, header_row: true } } },
      ...["c1", "c2", "c3", "c4"].map((id) => ({ block_id: id, block_type: 32, parent_id: "t", children: [`${id}t`] })),
      ...["c1", "c2", "c3", "c4"].map((id) => ({ block_id: `${id}t`, block_type: 2, parent_id: id, text: run(`格${id}`) })),
      { block_id: "after", block_type: 2, parent_id: "p", text: run("表后") },
    ]);
    expect(html).toContain('<table class="doc-table"><thead><tr><th><p>格c1</p></th><th><p>格c2</p></th></tr></thead><tbody><tr><td><p>格c3</p></td><td><p>格c4</p></td></tr></tbody></table>');
    expect(html.match(/格c1/g)).toHaveLength(1);
    expect(html.endsWith("<p>表后</p>")).toBe(true);
  });
  it("嵌套列表放进父项，高亮块展开内容", () => {
    const html = blocksToHtml([
      { block_id: "p", block_type: 1, children: ["a", "box"] },
      { block_id: "a", block_type: 12, parent_id: "p", bullet: run("父"), children: ["a1"] },
      { block_id: "a1", block_type: 13, parent_id: "a", ordered: run("子") },
      { block_id: "box", block_type: 19, parent_id: "p", children: ["bt"] },
      { block_id: "bt", block_type: 2, parent_id: "box", text: run("提示") },
    ]);
    expect(html).toBe(["<ul>", "<li>父\n<ol>\n<li>子</li>\n</ol></li>", "</ul>", "<p>提示</p>"].join("\n"));
  });
  it("图片：有附件地址时输出 img，没有时占位", () => {
    const blocks = [
      { block_id: "p", block_type: 1, children: ["i1", "i2"] },
      { block_id: "i1", block_type: 27, parent_id: "p", image: { token: "IMG1" } },
      { block_id: "i2", block_type: 27, parent_id: "p", image: { token: "IMG2" } },
    ];
    expect(imageTokens(blocks)).toEqual(["IMG1", "IMG2"]);
    const html = blocksToHtml(blocks, { image: (t) => (t === "IMG1" ? "/api/attachments/abc123" : undefined) });
    expect(html).toContain('<img src="/api/attachments/abc123" alt="图片">');
    expect(html).toContain("［图片：请到飞书原文查看］");
  });
});

describe("T33 每天自动同步", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const link = { id: "l", name: "需求文档", kind: "docx", token: "t", spaceId: "s", parentPageId: null, autoSync: "daily", importAs: "doc", lastAutoAt: null, createdById: "u" };
  beforeEach(() => {
    vi.resetAllMocks();
    mock.linkClaim.mockResolvedValue({ count: 1 });
    mock.user.mockResolvedValue({ id: "u", email: "u@x", name: "U", globalRole: "member", avatarUrl: null, isActive: true, isDemo: false });
    mock.canView.mockResolvedValue(true);
    mock.canEdit.mockResolvedValue(true);
    mock.listDocs.mockResolvedValue([]);
  });
  it("满 24 小时才执行，并以创建人身份同步", async () => {
    mock.linkFindMany.mockResolvedValue([link, { ...link, id: "recent", lastAutoAt: new Date(now.getTime() - 3600_000) }]);
    expect(await runDueCloudDocSync(now)).toBe(1);
    expect(mock.linkClaim).toHaveBeenCalledTimes(1);
    expect(mock.linkClaim).toHaveBeenCalledWith({ where: { id: "l", lastAutoAt: null }, data: { lastAutoAt: now } });
    expect(mock.activity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "u", action: "synced" }) }));
  });
  it("别的进程已认领时跳过", async () => {
    mock.linkFindMany.mockResolvedValue([link]);
    mock.linkClaim.mockResolvedValue({ count: 0 });
    expect(await runDueCloudDocSync(now)).toBe(0);
    expect(mock.listDocs).not.toHaveBeenCalled();
  });
  it("创建人停用或没有编辑权限时跳过并记录原因", async () => {
    mock.linkFindMany.mockResolvedValue([link]);
    mock.user.mockResolvedValueOnce({ id: "u", email: "u@x", name: "U", globalRole: "member", isActive: false, isDemo: false });
    expect(await runDueCloudDocSync(now)).toBe(0);
    expect(mock.linkUpdate).toHaveBeenCalledWith({ where: { id: "l" }, data: { lastResult: expect.stringContaining("停用") } });
    mock.canEdit.mockResolvedValueOnce(false);
    expect(await runDueCloudDocSync(now)).toBe(0);
    expect(mock.linkUpdate).toHaveBeenLastCalledWith({ where: { id: "l" }, data: { lastResult: expect.stringContaining("编辑权限") } });
    expect(mock.listDocs).not.toHaveBeenCalled();
  });
});
