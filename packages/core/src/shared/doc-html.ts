import sanitizeHtml from "sanitize-html";
import { safeRedirectPath } from "./safe-path";
import { escapeHtml, textToHtml } from "./doc-text";

export { escapeHtml, textToHtml };

/**
 * 文档正文 HTML：编辑器（contentEditable）产出 → 服务端白名单清洗后入库；
 * 阅读时再给标题加锚点、把需求 / Bug 引用刷新成实时标题与状态。
 *
 * 解析和输出交给 sanitize-html（htmlparser2），这里只定义白名单：
 * 白名单外的标签丢弃（保留文字），script / style 等连同内容一起丢弃，未闭合的标签由解析器补齐。
 */

const ALLOWED_TAGS = [
  "p", "br", "h1", "h2", "h3", "strong", "em", "u", "s", "code", "pre",
  "blockquote", "ul", "ol", "li", "a", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "hr", "img",
];
/** 配图只能是本系统上传的附件 */
const ATTACHMENT_SRC = /^\/api\/attachments\/[a-z0-9]{6,40}$/i;
const ALIGNS = new Set(["center", "right"]);
const ALIGNABLE = new Set(["p", "h1", "h2", "h3", "div", "li"]);
/** b / i / strike 统一为语义标签 */
const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s" };
/** 连同内容一起丢弃 */
const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "textarea",
  "select", "title", "head", "frame", "frameset", "applet", "audio", "video", "canvas",
];

const ALLOWED_CLASSES = new Set([
  "doc-board-link",
  "doc-todo", "doc-panel", "doc-status", "doc-ref", "doc-ref-code", "doc-ref-title", "doc-ref-status", "doc-table",
  "doc-color-gray", "doc-color-red", "doc-color-orange", "doc-color-green", "doc-color-blue", "doc-color-purple",
]);
const TONES = new Set(["info", "note", "warning", "success", "neutral", "danger", "purple"]);

const MAX_LEN = 400_000;

function decodeEntities(v: string) {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 0))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10) || 0))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 链接只允许 http、https、mailto、站内路径和页内锚点 */
function safeHref(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!v) return null;
  if (v.startsWith("#")) return v;
  if (v.startsWith("/")) return safeRedirectPath(v, "") || null;
  if (/^(https?:|mailto:)/i.test(v)) return v;
  return null;
}

/** 逐个属性按白名单取值：名字允许不够，值也要合法 */
function cleanAttribs(tag: string, raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const n = (v: string) => parseInt(v, 10);
  for (const [name, value] of Object.entries(raw)) {
    if (name === "class") {
      // 代码块的语言（language-mermaid 画流程图、language-math 显示公式、其他用于标注）只放在 code 上
      const cls = value.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c) || (tag === "code" && /^language-[a-z0-9+#-]{1,24}$/.test(c)));
      if (cls.length) out.class = cls.join(" ");
    } else if (name === "href" && tag === "a") {
      const href = safeHref(value);
      if (href) {
        out.href = href;
        if (/^https?:/i.test(href)) {
          out.target = "_blank";
          out.rel = "noopener noreferrer";
        }
      }
    } else if (name === "data-checked" && tag === "li") {
      if (value === "true") out[name] = "true";
    } else if (name === "data-tone") {
      if (TONES.has(value)) out[name] = value;
    } else if (name === "data-ref-kind") {
      if (value === "req" || value === "bug") out[name] = value;
    } else if (name === "data-ref-id") {
      if (/^[a-z0-9]{6,40}$/i.test(value)) out[name] = value;
    } else if ((name === "colspan" || name === "rowspan") && (tag === "td" || tag === "th")) {
      if (n(value) > 1 && n(value) < 50) out[name] = String(n(value));
    } else if (name === "src" && tag === "img") {
      if (ATTACHMENT_SRC.test(value)) out.src = value;
    } else if (name === "width" && tag === "img") {
      // 编辑器里拖动缩放后的显示宽度（px）
      if (n(value) >= 40 && n(value) <= 4000) out.width = String(n(value));
    } else if (name === "alt" && tag === "img") {
      out.alt = value.slice(0, 200);
    } else if (name === "data-align" && ALIGNABLE.has(tag)) {
      if (ALIGNS.has(value)) out[name] = value;
    } else if (name === "style" && ALIGNABLE.has(tag)) {
      // 编辑器 justifyCenter / justifyRight 产出 style="text-align: …"，转成 data-align
      const align = /text-align:\s*(center|right)/i.exec(value)?.[1]?.toLowerCase();
      if (align && !raw["data-align"]) out["data-align"] = align;
    } else if (name === "contenteditable" && (tag === "a" || tag === "span") && value === "false") {
      out[name] = "false";
    }
  }
  return out;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // 第二道保险：cleanAttribs 之外的属性名一律去掉
  allowedAttributes: {
    "*": ["class", "href", "target", "rel", "data-checked", "data-tone", "data-ref-kind", "data-ref-id", "colspan", "rowspan", "src", "width", "alt", "data-align", "contenteditable"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  parseStyleAttributes: false,
  disallowedTagsMode: "discard",
  nonTextTags: DROP_WITH_CONTENT,
  transformTags: {
    "*": (tagName, attribs) => {
      const tag = RENAME[tagName] ?? tagName;
      return { tagName: tag, attribs: cleanAttribs(tag, attribs) };
    },
  },
  // 没有合法 src 的图片整个去掉
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

/** 清洗编辑器产出的 HTML，只保留白名单标签与属性。 */
export function sanitizeDocHtml(input: string): string {
  return (
    sanitizeHtml(String(input || "").slice(0, MAX_LEN), SANITIZE_OPTIONS)
      // 库里和阅读逻辑用的都是 <br> 写法（docPlainText 等靠它换行）
      .replace(/<(br|hr|img)\b([^>]*?)\s*\/>/g, "<$1$2>")
      // 编辑器删除内容后常留下空段落
      .replace(/<p><\/p>/g, "")
      .trim()
  );
}

/** 去掉标签，得到纯文本（用于摘要、阅读时长、搜索） */
export function docPlainText(html: string) {
  return decodeEntities(html.replace(/<(br|\/p|\/h[1-3]|\/li|\/tr|\/div)>/g, "\n").replace(/<[^>]+>/g, ""))
    .replace(/ /g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readingMinutes(html: string) {
  const chars = docPlainText(html).replace(/\s/g, "").length;
  return Math.max(1, Math.round(chars / 400));
}

export type DocRef = { kind: "req" | "bug"; id: string };

/** 正文里插入的需求 / Bug 引用 */
export function extractRefs(html: string): DocRef[] {
  const out = new Map<string, DocRef>();
  const re = /<a\b[^>]*class="doc-ref"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const kind = /data-ref-kind="(req|bug)"/.exec(m[0])?.[1] as DocRef["kind"] | undefined;
    const id = /data-ref-id="([a-z0-9]+)"/i.exec(m[0])?.[1];
    if (kind && id) out.set(`${kind}:${id}`, { kind, id });
  }
  return Array.from(out.values());
}

export type TocItem = { id: string; level: number; text: string };

export type RefInfo = { title: string; code: string; status: string; tone: string; href: string };

/**
 * 阅读态渲染：给 h1–h3 加锚点 id 并生成目录；把引用刷新为实时标题和状态。
 * 输入必须是已清洗的 HTML。
 */
export function renderDocHtml(html: string, refs: Map<string, RefInfo>): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  let n = 0;
  let out = html.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (_, lv: string, inner: string) => {
    const id = `h-${++n}`;
    const text = docPlainText(inner);
    if (text) toc.push({ id, level: Number(lv), text });
    return `<h${lv} id="${id}">${inner}</h${lv}>`;
  });
  out = out.replace(/<a\b([^>]*class="doc-ref"[^>]*)>([\s\S]*?)<\/a>/g, (whole, attrs: string) => {
    const kind = /data-ref-kind="(req|bug)"/.exec(attrs)?.[1];
    const id = /data-ref-id="([a-z0-9]+)"/i.exec(attrs)?.[1];
    if (!kind || !id) return whole;
    const info = refs.get(`${kind}:${id}`);
    if (!info) {
      return `<span class="doc-ref is-missing">${kind === "req" ? "需求" : "Bug"}已删除</span>`;
    }
    return (
      `<a class="doc-ref" data-ref-kind="${kind}" data-ref-id="${id}" href="${escapeHtml(info.href)}">` +
      `<span class="doc-ref-code">${escapeHtml(info.code)}</span>` +
      `<span class="doc-ref-title">${escapeHtml(info.title)}</span>` +
      `<span class="doc-ref-status" data-tone="${info.tone}">${escapeHtml(info.status)}</span></a>`
    );
  });
  return { html: out, toc };
}
