import { parseDocument } from "htmlparser2";
import render from "dom-serializer";
import type { ChildNode } from "domhandler";
import { marked } from "marked";
import { docPlainText, sanitizeDocHtml } from "../shared/doc-html";

/**
 * 需求交付 · PRD 正文按「顶层块」处理：给模型看带编号的块，模型按块号提修改建议；
 * 应用时按块的原始 HTML 找回位置（不按序号），原文被改过就找不到、拒绝自动应用。
 */

/** Markdown → 清洗后的文档 HTML（h4 以下降成 h3，编辑器只有三级标题） */
export function mdToHtml(md: string) {
  const raw = marked.parse(String(md || ""), { async: false, gfm: true, breaks: false }) as string;
  return sanitizeDocHtml(raw.replace(/<(\/?)h[4-6]\b/g, "<$1h3"));
}

/** 模型常把整段包在 ```markdown 里，去掉外层代码块 */
export function stripFence(text: string) {
  const t = String(text || "").trim();
  const m = t.match(/^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i);
  return m ? m[1] : t;
}

const renderNode = (n: ChildNode) => render(n, { encodeEntities: "utf8" });

export function splitBlocks(html: string): string[] {
  const doc = parseDocument(String(html || ""));
  return doc.children.filter((n) => !(n.type === "text" && !("data" in n && String(n.data).trim()))).map(renderNode);
}

export function joinBlocks(blocks: string[]) {
  return sanitizeDocHtml(blocks.join("\n"));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function blockLabel(html: string) {
  const h = html.match(/^<h([1-3])\b/);
  const text = docPlainText(html).replace(/\n+/g, h ? " " : "\n");
  if (h) return `${"#".repeat(Number(h[1]))} ${text}`;
  if (/^<(ul|ol)\b/.test(html)) return text.split("\n").filter(Boolean).map((l) => `- ${l}`).join("\n");
  return text;
}

/** 给模型看的 PRD：[B1] … 每块一段，单块和总长度都截断 */
export function blocksForAi(blocks: string[]) {
  let out = "";
  blocks.forEach((b, i) => {
    const line = `[B${i + 1}] ${blockLabel(b).slice(0, 1500)}\n`;
    if (out.length + line.length < 40_000) out += line;
  });
  return out;
}

export function blockPreview(html: string, n = 600) {
  return blockLabel(html).slice(0, n);
}

/** 「待确认问题」一节下的条目（标题之后、下一个标题之前的列表项和段落），「无」不算 */
export function openQuestions(html: string): string[] {
  const blocks = splitBlocks(html);
  const at = blocks.findIndex((b) => /^<h[1-3]\b/.test(b) && /待确认/.test(docPlainText(b)));
  if (at < 0) return [];
  const out: string[] = [];
  for (const b of blocks.slice(at + 1)) {
    if (/^<h[1-3]\b/.test(b)) break;
    for (const line of docPlainText(b).split("\n")) {
      const t = line.replace(/^\s*(\d+[.、)]|[-*•])\s*/, "").trim();
      if (t && !/^(无|暂无|没有)[。.]?$/.test(t)) out.push(t);
    }
  }
  return out.slice(0, 50);
}

/** 正文里出现的功能点编号 F-01…，按首次出现排序 */
export function featureCodes(html: string): string[] {
  const seen = new Set<string>();
  for (const m of docPlainText(html).matchAll(/\bF-(\d{1,4})\b/gi)) seen.add(`F-${m[1].padStart(2, "0")}`);
  return Array.from(seen);
}

/** 功能清单里的条目：列表项以 F-01 开头的，取编号和后面的名称 */
export function featureItems(html: string): { code: string; title: string }[] {
  const out = new Map<string, string>();
  for (const m of String(html || "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
    const t = docPlainText(m[1]).replace(/\s+/g, " ").trim();
    const f = t.match(/^F-?(\d{1,4})\s*[:：、.．-]?\s*(.+)$/i);
    if (f && !out.has(`F-${f[1].padStart(2, "0")}`)) out.set(`F-${f[1].padStart(2, "0")}`, f[2].slice(0, 180));
  }
  return Array.from(out, ([code, title]) => ({ code, title }));
}

export type BlockOp = { op: "replace" | "insert_after" | "delete"; targetHtml: string; html: string };

/** 应用一条块级修改；找不到原块（原文被改过）返回 null */
export function applyBlockOp(html: string, op: BlockOp): string | null {
  const blocks = splitBlocks(html);
  const want = norm(op.targetHtml);
  const i = blocks.findIndex((b) => norm(b) === want);
  if (i < 0) return null;
  const add = op.html ? splitBlocks(op.html) : [];
  if (op.op === "replace") blocks.splice(i, 1, ...add);
  else if (op.op === "insert_after") blocks.splice(i + 1, 0, ...add);
  else blocks.splice(i, 1);
  return joinBlocks(blocks);
}
