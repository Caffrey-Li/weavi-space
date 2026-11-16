import { FeishuApiError, feishuFetch } from "../shared/feishu-api";

/** 飞书云文档 → HTML（只转换文字类块；图片、表格等暂以占位文字保留位置） */
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
type Block = { block_id: string; block_type: number; [k: string]: unknown };

/** 块列表 → HTML；相邻的列表项合成 ul / ol */
export function blocksToHtml(blocks: Block[]) {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of blocks) {
    const t = b.block_type;
    const body = (k: string) => inline((b[k] as { elements?: Elem[] } | undefined)?.elements);
    if (t === 12 || t === 13) {
      const want = t === 12 ? "ul" : "ol";
      if (list !== want) {
        close();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${body(t === 12 ? "bullet" : "ordered")}</li>`);
      continue;
    }
    close();
    if (t === 1) continue; // 页面本身
    if (t === 2) out.push(`<p>${body("text")}</p>`);
    else if (HEADING_KEY[t]) out.push(`<h${Math.min(t - 2, 3)}>${body(HEADING_KEY[t])}</h${Math.min(t - 2, 3)}>`);
    else if (t === 14) out.push(`<pre><code>${body("code")}</code></pre>`);
    else if (t === 15) out.push(`<blockquote><p>${body("quote")}</p></blockquote>`);
    else if (t === 17) out.push(`<p>${(b.todo as { style?: { done?: boolean } } | undefined)?.style?.done ? "☑" : "☐"} ${body("todo")}</p>`);
    else if (t === 22) out.push("<hr>");
    else if (t === 27) out.push("<p>［图片：请到飞书原文查看］</p>");
    else if (t === 31) out.push("<p>［表格：请到飞书原文查看］</p>");
  }
  close();
  return out.join("\n");
}

export async function readDocx(documentId: string) {
  const meta = await feishuFetch<{ document?: { title?: string } }>(`/docx/v1/documents/${documentId}`);
  const blocks: Block[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const d = await feishuFetch<{ items?: Block[]; has_more?: boolean; page_token?: string }>(`/docx/v1/documents/${documentId}/blocks`, { query: { page_size: 500, page_token: pageToken } });
    blocks.push(...(d.items || []));
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return { title: meta.document?.title || "无标题文档", html: blocksToHtml(blocks) };
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
