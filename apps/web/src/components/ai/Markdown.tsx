"use client";

import { useMemo } from "react";
import { Marked, type Tokens } from "marked";

/**
 * AI 回答的 Markdown 渲染（Figma「82」106，版式参照 ChatGPT）：标题、段落、列表、表格、代码块、引用、加粗、链接。
 * 安全：模型输出里的原始 HTML 一律当文本转义显示；链接只允许 http(s)、mailto 和站内路径，外链新窗口打开；
 * 不加载外部图片（图片显示成链接）。marked 本身会转义普通文本。
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function safeHref(href: string | null | undefined): string | null {
  const h = String(href || "").trim();
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  return null;
}

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return esc(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      const ext = !href.startsWith("/");
      return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${text}</a>`;
    },
    image(token: Tokens.Image) {
      const href = safeHref(token.href);
      const label = esc(token.text || "图片");
      return href && /^https?:/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">[${label}]</a>` : label;
    },
    table(token: Tokens.Table) {
      const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
      const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
      return `<div class="nv-md-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    },
    code(token: Tokens.Code) {
      const lang = (token.lang || "").match(/^[\w+-]{1,20}/)?.[0] || "";
      return `<pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(token.text)}</code></pre>`;
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src || "") as string;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`nv-md ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}
