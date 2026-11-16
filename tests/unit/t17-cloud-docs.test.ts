import { describe, expect, it } from "vitest";
import { blocksToHtml, parseDocUrl } from "@pm-collab/core/cloud-docs/feishu-docx";

describe("飞书云文档链接", () => {
  it.each([
    ["https://acme.feishu.cn/docx/AbC123", "docx", "AbC123"],
    ["https://acme.feishu.cn/wiki/WkN0de?from=x", "wiki", "WkN0de"],
    ["https://acme.feishu.cn/drive/folder/FoLd3r", "folder", "FoLd3r"],
  ])("解析 %s", (url, kind, token) => expect(parseDocUrl(url)).toEqual({ kind, token }));
  it.each([["https://evil.example/docx/abc"], ["not a url"], ["https://acme.feishu.cn/sheets/abc"]])("拒绝 %s", (u) => expect(() => parseDocUrl(u)).toThrow());
});

describe("块转 HTML", () => {
  const run = (content: string, style = {}) => ({ elements: [{ text_run: { content, text_element_style: style } }] });
  it("标题、段落、列表、代码、引用、分割线", () => {
    const html = blocksToHtml([
      { block_id: "1", block_type: 1 },
      { block_id: "2", block_type: 3, heading1: run("概述") },
      { block_id: "3", block_type: 2, text: run("加粗", { bold: true }) },
      { block_id: "4", block_type: 12, bullet: run("甲") },
      { block_id: "5", block_type: 12, bullet: run("乙") },
      { block_id: "6", block_type: 13, ordered: run("一") },
      { block_id: "7", block_type: 14, code: run("x < 1") },
      { block_id: "8", block_type: 15, quote: run("引") },
      { block_id: "9", block_type: 22 },
    ]);
    expect(html).toBe(["<h1>概述</h1>", "<p><strong>加粗</strong></p>", "<ul>", "<li>甲</li>", "<li>乙</li>", "</ul>", "<ol>", "<li>一</li>", "</ol>", "<pre><code>x &lt; 1</code></pre>", "<blockquote><p>引</p></blockquote>", "<hr>"].join("\n"));
  });
  it("转义 HTML，只保留 http(s) 链接", () => {
    const html = blocksToHtml([
      { block_id: "1", block_type: 2, text: run("<script>alert(1)</script>") },
      { block_id: "2", block_type: 2, text: run("点我", { link: { url: encodeURIComponent("javascript:alert(1)") } }) },
      { block_id: "3", block_type: 2, text: run("官网", { link: { url: encodeURIComponent("https://example.com/a?b=1") } }) },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://example.com/a?b=1">官网</a>');
  });
});
