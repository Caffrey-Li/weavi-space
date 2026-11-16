import { prisma } from "@pm-collab/db/prisma";
import { canNest } from "../shared/products";
import { clampTitle, htmlToText, titleFromText } from "../shared/title-gen-shared";

/**
 * 根据产品文档和需求生成功能结构（菜单 › 功能模块 › 功能点）。
 * 配置了 ANTHROPIC_API_KEY 时让 Claude 提炼；否则按文档标题层级整理，需求按名称匹配挂到模块下。
 * 只做预览，写入由 applyGenerated 完成：只新增，同名节点跳过。
 */
export type GenType = "menu" | "module" | "feature";
export type GenNode = { key: string; type: GenType; name: string; source?: string; existingId?: string; children: GenNode[] };
export type GenSources = { docs: boolean; reqs: boolean };
export type GenResult = {
  mode: "ai" | "rules";
  tree: GenNode[];
  counts: { add: number; exists: number };
  sources: { docs: number; reqs: number };
  note?: string;
};

const MAX_NAME = 30;
/** 文档里的通用章节，不当作功能 */
const SKIP_HEADING = /^.{0,6}(背景|目标|概述|简介|引言|前言|说明|目录|修订记录|版本记录|变更记录|文档说明|术语|名词解释|附录|参考|参考资料|验收标准|非功能需求|性能要求|安全要求|风险|里程碑|排期|计划|待定问题|待确认|问题|结论|行动项|待办|总结|其他|备注)([与和及、].*)?$/;
/** 会议纪要、计划、复盘之类的过程文档不参与规则整理（AI 模式仍会读取，自行判断） */
const SKIP_DOC = /纪要|会议|周会|例会|晨会|复盘|日报|周报记录|发版计划|上线计划|排期|版本计划|进展|总结|模板/;

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function cleanName(raw: string): string {
  const s = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:第[一二三四五六七八九十\d]+[章节部分]\s*|\d+(?:\.\d+)*[.、．]?\s*|[一二三四五六七八九十]+[、.．]\s*|[（(][一二三四五六七八九十\d]+[)）]\s*|[-*•·●○]\s*)/, "")
    .replace(/[：:。；;，,]+$/, "");
  return Array.from(s).length > MAX_NAME ? clampTitle(s, MAX_NAME) : s;
}

// ---------- 读取来源 ----------
type DocSrc = { title: string; html: string };
type ReqSrc = { code: string; title: string; text: string };

async function loadSources(productId: string, src: GenSources) {
  const projects = await prisma.project.findMany({ where: { productId }, select: { id: true, key: true } });
  const pids = projects.map((p) => p.id);
  const docs: DocSrc[] = src.docs && pids.length
    ? (await prisma.docPage.findMany({ where: { projectId: { in: pids } }, select: { title: true, body: true, draftBody: true }, orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }], take: 200 }))
        .map((d) => ({ title: d.title, html: d.body || d.draftBody || "" }))
        .filter((d) => d.html.trim())
    : [];
  const keyOf = new Map(projects.map((p) => [p.id, p.key]));
  const reqs: ReqSrc[] = src.reqs
    ? (
        await prisma.requirement.findMany({
          where: { OR: [{ productId }, ...(pids.length ? [{ projectId: { in: pids } }] : [])], archivedAt: null, status: { not: "cancelled" } },
          select: { id: true, title: true, summary: true, projectId: true },
          orderBy: { updatedAt: "desc" },
          take: 400,
        })
      ).map((r) => ({
        code: `${(r.projectId && keyOf.get(r.projectId)) || "REQ"}-${r.id.slice(-4).toUpperCase()}`,
        title: r.title,
        text: (r.summary || "").slice(0, 300),
      }))
    : [];
  return { docs, reqs };
}

// ---------- 规则：按文档标题层级 ----------
type Token = { kind: "h"; level: number; text: string } | { kind: "li"; text: string };

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const re = /<(h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    // 列表项只取自身文字，不含嵌套列表
    const inner = tag === "li" ? m[2].replace(/<(ul|ol)\b[\s\S]*$/i, "") : m[2];
    const text = htmlToText(inner).replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push(tag === "li" ? { kind: "li", text } : { kind: "h", level: Number(tag[1]), text });
  }
  return out;
}

type Draft = { name: string; source: string; modules: { name: string; source: string; features: { name: string; source: string }[] }[] };

function rulesFromDoc(doc: DocSrc): Draft[] {
  if (SKIP_DOC.test(doc.title)) return [];
  const tokens = tokenize(doc.html);
  const levels = Array.from(new Set(tokens.filter((t): t is Extract<Token, { kind: "h" }> => t.kind === "h").map((t) => t.level))).sort((a, b) => a - b);
  if (!levels.length) return [];
  const src = `《${doc.title}》`;
  const menus: Draft[] = [];
  const twoLevel = levels.length >= 2;
  const [L1, L2] = twoLevel ? [levels[0], levels[1]] : [-1, levels[0]];
  let menu: Draft | null = twoLevel ? null : { name: cleanName(doc.title), source: src, modules: [] };
  if (menu) menus.push(menu);
  let mod: Draft["modules"][number] | null = null;
  let skipping = false;
  for (const t of tokens) {
    if (t.kind === "h") {
      const name = cleanName(t.text);
      if (t.level <= L1) {
        skipping = !name || SKIP_HEADING.test(name);
        mod = null;
        if (!skipping) menus.push((menu = { name, source: src, modules: [] }));
        continue;
      }
      if (skipping) continue;
      if (t.level === L2 || (t.level < L2 && t.level > L1)) {
        if (!name || SKIP_HEADING.test(name)) {
          mod = null;
          continue;
        }
        if (!menu) menus.push((menu = { name: cleanName(doc.title), source: src, modules: [] }));
        menu.modules.push((mod = { name, source: src, features: [] }));
        continue;
      }
      // 更深一级标题 → 功能点
      if (mod && name && !SKIP_HEADING.test(name)) mod.features.push({ name, source: src });
      continue;
    }
    if (skipping || !mod) continue;
    const name = clampTitle(titleFromText(t.text) || cleanName(t.text), 20);
    if (name && mod.features.length < 30) mod.features.push({ name, source: src });
  }
  return menus.filter((m) => m.modules.length);
}

// ---------- AI ----------
async function draftByModel(docs: DocSrc[], reqs: ReqSrc[], existing: string[]): Promise<Draft[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  let budget = 60000;
  const docText = docs
    .map((d) => {
      const t = htmlToText(d.html).replace(/\n{3,}/g, "\n\n").slice(0, Math.max(0, Math.min(budget, 12000)));
      budget -= t.length;
      return t ? `### 文档《${d.title}》\n${t}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const reqText = reqs.slice(0, 300).map((r) => `- ${r.code} ${r.title}${r.text ? `：${r.text.slice(0, 80)}` : ""}`).join("\n");
  const system = [
    "你是产品经理，负责整理一个软件产品的功能结构清单。层级固定为：菜单（对应系统导航）› 功能模块 › 功能点（可交付的最小功能）。",
    "根据给出的产品文档和需求提炼功能结构；只写系统真实具备或计划具备的功能，不写背景、目标、验收标准等章节。",
    "名称用简体中文，菜单和模块不超过 12 个字，功能点不超过 20 个字。已有结构里的名称请原样沿用，便于合并。",
    "每个功能点的 source 写依据：文档写《文档标题》，需求写需求编号。",
    '只输出 JSON，不要任何解释：{"menus":[{"name":"","modules":[{"name":"","features":[{"name":"","source":""}]}]}]}',
  ].join("\n");
  const user = [`已有结构（菜单 / 模块 / 功能点名称）：\n${existing.slice(0, 400).join("、") || "（无）"}`, docText ? `产品文档：\n${docText}` : "", reqText ? `需求：\n${reqText}` : ""].filter(Boolean).join("\n\n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { menus?: { name?: string; modules?: { name?: string; features?: { name?: string; source?: string }[] }[] }[] };
    return (parsed.menus || []).map((m) => ({
      name: cleanName(String(m.name || "")),
      source: "",
      modules: (m.modules || []).map((md) => ({
        name: cleanName(String(md.name || "")),
        source: "",
        features: (md.features || []).map((f) => ({ name: clampTitle(cleanName(String(f.name || "")), 20), source: String(f.source || "").slice(0, 40) })).filter((f) => f.name),
      })).filter((md) => md.name),
    })).filter((m) => m.name && m.modules.length);
  } catch (e) {
    console.error("[功能结构生成] 大模型调用失败，改用规则", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 合并与对照现有结构 ----------
type Existing = { id: string; parentId: string | null; type: string; name: string };

function mergeDrafts(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const d of drafts) {
    let m = out.find((x) => norm(x.name) === norm(d.name));
    if (!m) out.push((m = { name: d.name, source: d.source, modules: [] }));
    for (const md of d.modules) {
      let t = m.modules.find((x) => norm(x.name) === norm(md.name));
      if (!t) m.modules.push((t = { name: md.name, source: md.source, features: [] }));
      for (const f of md.features) if (!t.features.some((x) => norm(x.name) === norm(f.name))) t.features.push(f);
    }
  }
  return out;
}

/** 规则模式：需求按名称匹配挂到模块下（需求标题 / 描述里出现了模块名） */
function attachReqs(drafts: Draft[], reqs: ReqSrc[], existing: Existing[]) {
  const modules: { name: string; target: Draft["modules"][number] | null; menuName: string; existingId?: string }[] = [];
  for (const m of drafts) for (const md of m.modules) modules.push({ name: md.name, target: md, menuName: m.name });
  const byId = new Map(existing.map((n) => [n.id, n]));
  for (const n of existing) if (n.type === "module" && !modules.some((x) => norm(x.name) === norm(n.name))) modules.push({ name: n.name, target: null, menuName: n.parentId ? byId.get(n.parentId)?.name || "" : "", existingId: n.id });
  // 名称长的优先，避免「需求」吃掉「需求评审」
  modules.sort((a, b) => b.name.length - a.name.length);
  let used = 0;
  for (const r of reqs) {
    const hay = norm(`${r.title} ${r.text}`);
    const hit = modules.find((x) => Array.from(x.name).length >= 2 && hay.includes(norm(x.name)));
    if (!hit) continue;
    let target = hit.target;
    if (!target) {
      // 挂到已有模块：在草稿里补一条同名菜单 / 模块路径，合并时会对上已有节点
      let menu = drafts.find((m) => norm(m.name) === norm(hit.menuName));
      if (!menu) drafts.push((menu = { name: hit.menuName || "未归类", source: "", modules: [] }));
      target = menu.modules.find((m) => norm(m.name) === norm(hit.name)) || null;
      if (!target) menu.modules.push((target = { name: hit.name, source: "", features: [] }));
      hit.target = target;
    }
    const name = clampTitle(titleFromText(r.title) || r.title, 20);
    if (name && !target.features.some((f) => norm(f.name) === norm(name)) && target.features.length < 40) {
      target.features.push({ name, source: `需求 ${r.code}` });
      used++;
    }
  }
  return used;
}

function toTree(drafts: Draft[], existing: Existing[]): { tree: GenNode[]; add: number; exists: number } {
  let seq = 0;
  let add = 0;
  let exists = 0;
  const kids = (parentId: string | null) => existing.filter((n) => n.parentId === parentId);
  const find = (parentId: string | null | undefined, name: string, types: string[]) =>
    parentId === undefined ? undefined : kids(parentId).find((n) => types.includes(n.type) && norm(n.name) === norm(name));
  const node = (type: GenType, name: string, source: string, parentExisting: string | null | undefined): GenNode => {
    // 模块也可能直接挂在顶层（已有结构里），菜单下找不到时再找全局同名模块
    let hit = find(parentExisting, name, [type]);
    if (!hit && type === "module") hit = existing.find((n) => n.type === "module" && norm(n.name) === norm(name));
    if (hit) exists++;
    else add++;
    return { key: `g${++seq}`, type, name, source: source || undefined, existingId: hit?.id, children: [] };
  };
  const tree: GenNode[] = [];
  for (const m of drafts) {
    const menu = node("menu", m.name, m.source, null);
    for (const md of m.modules) {
      const mod = node("module", md.name, md.source, menu.existingId ?? undefined);
      for (const f of md.features) mod.children.push(node("feature", f.name, f.source, mod.existingId ?? undefined));
      menu.children.push(mod);
    }
    tree.push(menu);
  }
  return { tree, add, exists };
}

export async function generateStructure(productId: string, src: GenSources): Promise<GenResult> {
  const { docs, reqs } = await loadSources(productId, src);
  const existing = await prisma.productNode.findMany({ where: { productId }, select: { id: true, parentId: true, type: true, name: true } });
  const sources = { docs: docs.length, reqs: reqs.length };
  if (!docs.length && !reqs.length) return { mode: "rules", tree: [], counts: { add: 0, exists: 0 }, sources, note: "所选来源里没有内容：产品和关联项目下还没有文档或需求" };

  let mode: GenResult["mode"] = "ai";
  let drafts = await draftByModel(docs, reqs, existing.map((n) => n.name));
  let note: string | undefined;
  if (!drafts) {
    mode = "rules";
    drafts = mergeDrafts(docs.flatMap(rulesFromDoc));
    const used = reqs.length ? attachReqs(drafts, reqs, existing) : 0;
    if (!drafts.length) note = docs.length ? "文档里没有找到标题层级，规则模式整理不出结构；可以给文档加上标题，或配置大模型后再试" : "没有找到能对上模块名称的需求；规则模式需要文档标题或已有模块作为依据";
    else if (reqs.length) note = `规则模式：${used} 条需求按名称挂到了模块下`;
  } else drafts = mergeDrafts(drafts);
  const { tree, add, exists } = toTree(drafts, existing);
  return { mode, tree, counts: { add, exists }, sources, note };
}

// ---------- 写入 ----------
export type ApplyNode = { type: GenType; name: string; existingId?: string; children?: ApplyNode[] };

/** 只新增：existingId 的节点沿用；同一上级下已有同名节点时跳过；层级不合规的跳过 */
export async function applyGenerated(productId: string, nodes: ApplyNode[]): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.productNode.findMany({ where: { productId }, select: { id: true, parentId: true, type: true, name: true, sortOrder: true } });
  const byId = new Map(existing.map((n) => [n.id, n]));
  let created = 0;
  let skipped = 0;
  let budget = 500;
  async function walk(list: ApplyNode[], parentId: string | null, parentType: string | null) {
    for (const n of list) {
      if (budget <= 0) return;
      const name = cleanName(String(n.name || "")).slice(0, 60);
      const type = n.type;
      let id: string | null = null;
      let myType: string | null = null;
      const ex = n.existingId ? byId.get(n.existingId) : undefined;
      if (ex) {
        id = ex.id;
        myType = ex.type;
      } else if (name && ["menu", "module", "feature"].includes(type) && canNest(parentType, type)) {
        const same = existing.find((x) => x.parentId === parentId && x.type === type && norm(x.name) === norm(name));
        if (same) {
          id = same.id;
          myType = same.type;
        } else {
          const sortOrder = Math.max(-1, ...existing.filter((x) => x.parentId === parentId).map((x) => x.sortOrder)) + 1;
          const row = await prisma.productNode.create({ data: { productId, parentId, type, name, sortOrder } });
          existing.push({ id: row.id, parentId, type, name, sortOrder });
          id = row.id;
          myType = type;
          created++;
          budget--;
        }
      } else {
        skipped++;
        continue;
      }
      if (n.children?.length) await walk(n.children, id, myType);
    }
  }
  await walk(nodes, null, null);
  if (created) await prisma.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
  return { created, skipped };
}
