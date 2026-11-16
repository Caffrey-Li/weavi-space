import { describe, expect, it } from "vitest";
import { renderMarkdown, safeHref } from "@/components/ai/Markdown";
import { todayLine } from "@pm-collab/core/ai/chat";

/** AI 回答的 Markdown 渲染：版式元素齐全，模型输出里的 HTML 和危险链接不生效 */
describe("AI 回答 Markdown", () => {
  it("标题、列表、加粗、表格、代码块", () => {
    const html = renderMarkdown("### 逾期需求\n\n共 **2 条**：\n\n- 导出报表\n- 移动端看板\n\n| 需求 | 负责人 |\n| --- | --- |\n| 导出报表 | 李技术 |\n\n```sql\nselect 1\n```");
    expect(html).toContain("<h3>逾期需求</h3>");
    expect(html).toContain("<strong>2 条</strong>");
    expect(html).toContain("<li>导出报表</li>");
    expect(html).toContain('<div class="nv-md-table"><table>');
    expect(html).toContain('<pre data-lang="sql"><code>select 1');
  });
  it("原始 HTML 当文本显示", () => {
    const html = renderMarkdown('你好 <img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain("&lt;script&gt;");
  });
  it("链接只允许 http(s)、mailto 和站内路径，外链新窗口打开", () => {
    expect(renderMarkdown("[点我](javascript:alert(1))")).not.toContain("href");
    expect(renderMarkdown("[需求](/requirements/abc)")).toContain('<a href="/requirements/abc">需求</a>');
    expect(renderMarkdown("[文档](https://example.com/a)")).toContain('target="_blank" rel="noopener noreferrer nofollow"');
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("data:text/html,1")).toBeNull();
  });
  it("不加载外部图片", () => {
    const html = renderMarkdown("![图](https://example.com/a.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("[图]");
  });
  it("代码块里的尖括号被转义", () => {
    expect(renderMarkdown("```\n<b>x</b>\n```")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("对话提示词里的今天", () => {
  it("带日期和星期，按服务器本机时间", () => {
    const line = todayLine(new Date(2026, 10, 15, 9, 5));
    expect(line).toContain("2026-11-15（星期日）");
    expect(line).toContain("09:05");
  });
});
