import { FeishuApiError, feishuFetch } from "../shared/feishu-api";

/** 飞书云文档 → HTML：文字类块、列表（含嵌套）、表格、图片（下载存成本系统附件）；其他块按容器展开或忽略 */
export type DocRef = { kind: "docx" | "wiki" | "folder"; token: string };

export function parseDocUrl(input: string): DocRef {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new FeishuApiError("请粘贴完整的飞书文档链接");
  }
  if (!/(^|\.)(feishu\.cn|larksuite\.com|feishu\.net)$/.test(u.hostname)) throw new FeishuApiError("只支持飞书（feishu.cn / larksuite.com）的文档链接");
  const m = u.pathname.match(/\/(docx|wiki|drive\/folder)\/([A-Za-z0-9]+)/);
  if (!m) throw new FeishuApiError("链接里找不到文档、知识库或文件夹的标识");
  return { kind: m[1] === "drive/folder" ? "folder" : (m[1] as "docx" | "wiki"), token: m[2] };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Elem = { text_run?: { content?: string; text_element_style?: { bold?: boolean; italic?: boolean; inline_code?: boolean; strikethrough?: boolean; link?: { url?: string } } }; mention_doc?: { title?: string } };
function inline(elements: Elem[] | undefined) {
  return (elements || [])
    .map((e) => {
      if (e.mention_doc) return esc(e.mention_doc.title || "");
      const run = e.text_run;
      if (!run) return "";
      let t = esc(run.content || "");
      const st = run.text_element_style || {};
      if (st.inline_code) t = `<code>${t}</code>`;
      if (st.bold) t = `<strong>${t}</strong>`;
      if (st.italic) t = `<em>${t}</em>`;
      if (st.strikethrough) t = `<s>${t}</s>`;
      const url = st.link?.url ? decodeURIComponent(st.link.url) : "";
      if (/^https?:\/\//.test(url)) t = `<a href="${esc(url)}">${t}</a>`;
      return t;
    })
    .join("");
}

const HEADING_KEY: Record<number, string> = { 3: "heading1", 4: "heading2", 5: "heading3", 6: "heading4", 7: "heading5", 8: "heading6", 9: "heading7", 10: "heading8", 11: "heading9" };
export type Block = { block_id: string; block_type: number; parent_id?: string; children?: string[]; [k: string]: unknown };
export type RenderOptions = {
  /** 图片 token → 本系统附件地址（/api/attachments/<id>）；没有时输出占位文字 */
  image?: (token: string) => string | undefined;
};

/** 文档里所有图片的 token（导入前先下载存成附件） */
export function imageTokens(blocks: Block[]) {
  const out: string[] = [];
  for (const b of blocks) {
    const t = (b.image as { token?: string } | undefined)?.token;
    if (b.block_type === 27 && t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 块列表 → HTML（T33：按父子结构递归转换）。
 * 飞书接口返回的是平铺的块列表，每块带 parent_id / children；从页面块（block_type 1）的 children 开始渲染，
 * 表格、单元格、高亮块、分栏、列表的嵌套子项都只在父块里输出一次。没有父子信息的旧数据按顺序平铺处理。
 * 相邻的列表项合成 ul / ol。
 */
export function blocksToHtml(blocks: Block[], opts: RenderOptions = {}) {
  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const page = blocks.find((b) => b.block_type === 1);
  const roots = page?.children?.length
    ? page.children.map((id) => byId.get(id)).filter((b): b is Block => Boolean(b))
    : blocks.filter((b) => b.block_type !== 1 && (!b.parent_id || !byId.has(b.parent_id)));
  const seen = new Set<string>();
  const kids = (b: Block) => (b.children || []).map((id) => byId.get(id)).filter((x): x is Block => Boolean(x));
  const render = (list: Block[], depth: number): string[] => {
    const out: string[] = [];
    let open: "ul" | "ol" | null = null;
    const close = () => {
      if (open) out.push(`</${open}>`);
      open = null;
    };
    for (const b of list) {
      if (seen.has(b.block_id) || depth > 12) continue;
      seen.add(b.block_id);
      const t = b.block_type;
      const body = (k: string) => inline((b[k] as { elements?: Elem[] } | undefined)?.elements);
      const nested = () => {
        const c = kids(b);
        return c.length ? render(c, depth + 1).join("\n") : "";
      };
      if (t === 12 || t === 13) {
        const want = t === 12 ? "ul" : "ol";
        if (open !== want) {
          close();
          out.push(`<${want}>`);
          open = want;
        }
        const inner = nested();
        out.push(`<li>${body(t === 12 ? "bullet" : "ordered")}${inner ? `\n${inner}` : ""}</li>`);
        continue;
      }
      close();
      if (t === 2) out.push(`<p>${body("text")}</p>`);
      else if (HEADING_KEY[t]) out.push(`<h${Math.min(t - 2, 3)}>${body(HEADING_KEY[t])}</h${Math.min(t - 2, 3)}>`);
      else if (t === 14) out.push(`<pre><code>${body("code")}</code></pre>`);
      else if (t === 15) out.push(`<blockquote><p>${body("quote")}</p></blockquote>`);
      else if (t === 17) out.push(`<p>${(b.todo as { style?: { done?: boolean } } | undefined)?.style?.done ? "☑" : "☐"} ${body("todo")}</p>`);
      else if (t === 22) out.push("<hr>");
      else if (t === 27) {
        const token = (b.image as { token?: string } | undefined)?.token;
        const src = token ? opts.image?.(token) : undefined;
        out.push(src ? `<p><img src="${esc(src)}" alt="图片"></p>` : "<p>［图片：请到飞书原文查看］</p>");
      } else if (t === 31) out.push(table(b, depth));
      else if (t === 34) out.push(`<blockquote>${nested()}</blockquote>`);
      else if (b.children?.length) out.push(nested()); // 高亮块、分栏等容器：直接输出里面的内容
    }
    close();
    return out.filter(Boolean);
  };
  const table = (b: Block, depth: number) => {
    const t = b.table as { cells?: string[]; property?: { row_size?: number; column_size?: number; header_row?: boolean } } | undefined;
    const cells = t?.cells?.length ? t.cells : b.children || [];
    const cols = Math.max(1, t?.property?.column_size || 1);
    const rows = Math.min(500, Math.max(1, t?.property?.row_size || Math.ceil(cells.length / cols)));
    const head = Boolean(t?.property?.header_row);
    const out: string[] = [`<table class="doc-table">${head ? "<thead>" : "<tbody>"}`];
    for (let r = 0; r < rows; r++) {
      const tag = head && r === 0 ? "th" : "td";
      const tds: string[] = [];
      for (let c = 0; c < cols; c++) {
        const cell = byId.get(cells[r * cols + c] || "");
        if (cell) seen.add(cell.block_id);
        const inner = cell ? render(kids(cell), depth + 1).join("") : "";
        tds.push(`<${tag}>${inner}</${tag}>`);
      }
      out.push(`<tr>${tds.join("")}</tr>`);
      if (head && r === 0) out.push("</thead><tbody>");
    }
    out.push("</tbody></table>");
    return out.join("");
  };
  return render(roots, 0).join("\n");
}

/** 读文档全部块（分页） */
export async function readBlocks(documentId: string) {
  const blocks: Block[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const d = await feishuFetch<{ items?: Block[]; has_more?: boolean; page_token?: string }>(`/docx/v1/documents/${documentId}/blocks`, { query: { page_size: 500, page_token: pageToken } });
    blocks.push(...(d.items || []));
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return blocks;
}

export async function readDocx(documentId: string, opts: { image?: (token: string) => Promise<string | undefined> } = {}) {
  const meta = await feishuFetch<{ document?: { title?: string } }>(`/docx/v1/documents/${documentId}`);
  const blocks = await readBlocks(documentId);
  const urls = new Map<string, string>();
  const warnings: string[] = [];
  if (opts.image) {
    for (const token of imageTokens(blocks).slice(0, 50)) {
      try {
        const u = await opts.image(token);
        if (u) urls.set(token, u);
      } catch (e) {
        warnings.push(`图片没能导入：${e instanceof Error ? e.message : "下载失败"}`);
      }
    }
  }
  return { title: meta.document?.title || "无标题文档", html: blocksToHtml(blocks, { image: (t) => urls.get(t) }), warnings };
}

/** 展开成要导入的 docx 列表：文档本身；知识库节点 = 节点 + 直属子节点；文件夹 = 里面的 docx */
export async function listSourceDocs(ref: DocRef): Promise<{ token: string; title?: string }[]> {
  if (ref.kind === "docx") return [{ token: ref.token }];
  if (ref.kind === "wiki") {
    const n = await feishuFetch<{ node?: { obj_token?: string; obj_type?: string; space_id?: string; node_token?: string; has_child?: boolean } }>(`/wiki/v2/spaces/get_node`, { query: { token: ref.token } });
    const out: { token: string }[] = [];
    if (n.node?.obj_type === "docx" && n.node.obj_token) out.push({ token: n.node.obj_token });
    if (n.node?.has_child && n.node.space_id) {
      const kids = await feishuFetch<{ items?: { obj_token?: string; obj_type?: string }[] }>(`/wiki/v2/spaces/${n.node.space_id}/nodes`, { query: { parent_node_token: n.node.node_token, page_size: 50 } });
      for (const k of kids.items || []) if (k.obj_type === "docx" && k.obj_token) out.push({ token: k.obj_token });
    }
    return out;
  }
  const f = await feishuFetch<{ files?: { token: string; type: string; name?: string }[] }>(`/drive/v1/files`, { query: { folder_token: ref.token, page_size: 200 } });
  return (f.files || []).filter((x) => x.type === "docx").map((x) => ({ token: x.token, title: x.name }));
}
