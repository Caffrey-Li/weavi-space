import yaml from "js-yaml";
import { strFromU8, unzipSync } from "fflate";
import { STEP_LABEL, type StepAction, type TestCase, type TestStep, cleanCase, sanitizeCases } from "../shared/testcases";

/**
 * 用例导入（T48）：常见的几种用例文件 → 结构化用例。
 * - CSV（Excel / 禅道 / TestRail 等导出，中英文表头都认）
 * - Excel .xlsx（读第一个工作表，表头同 CSV）
 * - JSON（本系统用例页格式 { cases } 或数组）
 * - YAML（caffrey-prd-plus 生成的可执行 YAML：cases[].steps / expect；也认普通的用例列表）
 * - Markdown 表格（首行表头）
 * - TestLink XML（<testcase>、<steps><step><actions>/<expectedresults>）
 * - XMind（.xmind：中心主题 › 模块 › 用例 › 步骤 › 预期，也认 用例 › 步骤 › 预期）
 * 所有结果都再经 cleanCase 清洗（标题必填、步骤数和长度有上限），不执行文件里的任何内容。
 */

export const IMPORT_FORMATS = [
  { key: "csv", label: "CSV（Excel 另存 / 禅道 / TestRail 导出）", ext: [".csv", ".txt"] },
  { key: "xlsx", label: "Excel（.xlsx）", ext: [".xlsx"] },
  { key: "json", label: "JSON", ext: [".json"] },
  { key: "yaml", label: "YAML（caffrey-prd-plus 可执行用例）", ext: [".yaml", ".yml"] },
  { key: "md", label: "Markdown 表格", ext: [".md", ".markdown"] },
  { key: "xml", label: "TestLink XML", ext: [".xml"] },
  { key: "xmind", label: "XMind 思维导图", ext: [".xmind"] },
] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number]["key"];

type Raw = Record<string, unknown>;
const MAX_ROWS = 2000;

// ---------- 表头 / 字段归一 ----------

const COLS: Record<string, string[]> = {
  code: ["编号", "用例编号", "用例id", "id", "code", "case id"],
  title: ["标题", "用例标题", "用例名称", "用例", "名称", "title", "name", "case title", "summary"],
  feature: ["功能点", "功能编号", "feature"],
  priority: ["优先级", "用例等级", "级别", "等级", "priority", "pri", "importance"],
  mode: ["执行方式", "方式", "测试方式", "mode", "execution", "执行类型"],
  precondition: ["前置条件", "前提", "预置条件", "precondition", "preconditions", "pre"],
  steps: ["步骤", "测试步骤", "操作步骤", "步骤描述", "steps", "step", "actions"],
  expected: ["预期", "预期结果", "期望结果", "expected", "expected result", "expected results", "expect"],
};
const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/[：:*]/g, "");

/** 优先级：P0–P3、1–4（禅道）、高 / 中 / 低、critical / high / medium / low */
export function normPriority(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  const m = s.match(/^p([0-3])$/);
  if (m) return `P${m[1]}`;
  // 纯数字按禅道：1 最高 … 4 最低；0 也当最高
  if (s === "0") return "P0";
  if (/^[1-4]$/.test(s)) return `P${Number(s) - 1}`;
  if (/最高|紧急|critical|blocker|highest/.test(s)) return "P0";
  if (/高|high|major/.test(s)) return "P1";
  if (/中|medium|normal/.test(s)) return "P2";
  if (/低|low|minor|trivial/.test(s)) return "P3";
  return "P2";
}

const LABEL_TO_ACTION = [...Object.entries(STEP_LABEL)].map(([k, v]) => [v, k as StepAction] as const).sort((a, b) => b[0].length - a[0].length);

/** 一行步骤：「打开 /login」「点击 登录」「输入 账号「admin」」；认不出的当人工步骤 */
export function parseStepLine(line: string): TestStep | null {
  const s = line.replace(/^\s*(?:\d+|[一二三四五六七八九十]+)[.、)）]\s*/, "").trim();
  if (!s) return null;
  for (const [label, action] of LABEL_TO_ACTION) {
    if (!s.startsWith(label + " ") && s !== label) continue;
    const rest = s.slice(label.length).trim();
    const m = rest.match(/^(.*?)\s*「(.*)」$/);
    if (m) return { action, target: m[1].trim(), value: m[2] };
    if (action === "wait") return { action, target: "", value: rest.replace(/\s*秒$/, "") };
    return { action, target: rest, value: "" };
  }
  return { action: "note", target: "", value: s.slice(0, 500) };
}

const splitLines = (v: unknown) => String(v ?? "").split(/\r?\n|；|;|<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean);

/** 表格行（CSV / Excel / Markdown 共用）→ 用例 */
function fromTable(rows: string[][]): { cases: Raw[]; error?: string } {
  const body = rows.filter((r) => r.some((c) => String(c ?? "").trim()));
  if (body.length < 2) return { cases: [], error: "至少要有表头和一行用例" };
  const head = body[0].map((h) => norm(String(h ?? "")));
  const idx = (k: string) => head.findIndex((h) => COLS[k].includes(h));
  if (idx("title") < 0) return { cases: [], error: "表头里要有「标题」或「用例名称」列" };
  const get = (r: string[], k: string) => (idx(k) >= 0 ? String(r[idx(k)] ?? "").trim() : "");
  const cases = body.slice(1, MAX_ROWS + 1).map((r) => {
    const steps = splitLines(get(r, "steps")).map(parseStepLine).filter((x): x is TestStep => !!x);
    return {
      code: get(r, "code"),
      title: get(r, "title"),
      feature: get(r, "feature"),
      priority: normPriority(get(r, "priority")),
      mode: /手工|手动|manual/i.test(get(r, "mode")) ? "manual" : "auto",
      precondition: get(r, "precondition"),
      steps,
      expected: splitLines(get(r, "expected")).join("；"),
    };
  });
  return { cases };
}

// ---------- CSV / Markdown ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  // 制表符分隔（从 Excel 直接复制粘贴）
  const sep = !t.split("\n")[0].includes(",") && t.split("\n")[0].includes("\t") ? "\t" : ",";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

function parseMarkdown(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  if (!lines.length) return { cases: [], error: "没有找到 Markdown 表格（| 标题 | 步骤 | 预期 |）" };
  return fromTable(lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/<br\s*\/?>/gi, "\n"))));
}

// ---------- YAML ----------

const actionText = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Raw).target ?? "") : String(v ?? ""));
/** caffrey-prd-plus 的动作 → 结构化步骤 */
function yamlStep(item: unknown): TestStep | null {
  if (typeof item === "string") return parseStepLine(item);
  if (!item || typeof item !== "object") return null;
  const [[k, v]] = Object.entries(item as Raw).length ? Object.entries(item as Raw) : [["", ""]];
  const target = actionText(v);
  const value = v && typeof v === "object" ? String((v as Raw).value ?? "") : "";
  switch (k) {
    case "open":
      return { action: "goto", target, value: "" };
    case "click":
    case "check":
    case "uncheck":
      return { action: "click", target, value: "" };
    case "input":
    case "fill":
      return { action: "fill", target, value };
    case "select":
      return { action: "select", target, value };
    case "press":
      return { action: "press", target: "", value: target };
    case "wait":
      return { action: "wait", target: "", value: String(v ?? "") };
    case "visible":
    case "enabled":
      return { action: "expectVisible", target, value: "" };
    case "text":
    case "contains":
      return { action: "expectText", target: value || target, value: "" };
    case "url":
      return { action: "expectUrl", target, value: "" };
    default:
      return { action: "note", target: "", value: `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`.slice(0, 500) };
  }
}

function parseYaml(text: string) {
  let doc: unknown;
  try {
    // js-yaml 4 的 load 默认就是安全模式（不支持 !!js/function 之类的类型）
    doc = yaml.load(text, { json: true });
  } catch (e) {
    return { cases: [], error: `YAML 格式不对：${(e as Error).message.split("\n")[0]}` };
  }
  const list = Array.isArray(doc) ? doc : doc && typeof doc === "object" && Array.isArray((doc as Raw).cases) ? ((doc as Raw).cases as unknown[]) : null;
  if (!list) return { cases: [], error: "YAML 里没有 cases 列表" };
  const cases = list.slice(0, MAX_ROWS).map((c) => {
    const r = (c && typeof c === "object" ? c : {}) as Raw;
    const steps = [...(Array.isArray(r.setup) ? r.setup.map((x) => ({ note: `准备：${typeof x === "string" ? x : JSON.stringify(x)}` })) : []), ...(Array.isArray(r.steps) ? r.steps : [])].map(yamlStep);
    const expects = Array.isArray(r.expect) ? r.expect.map(yamlStep) : [];
    const expectedText = typeof r.expected === "string" ? r.expected : Array.isArray(r.expect) ? r.expect.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("；") : "";
    return {
      code: String(r.id ?? r.code ?? ""),
      title: String(r.title ?? r.name ?? ""),
      feature: Array.isArray(r.feature) ? String(r.feature[0] ?? "") : String(r.feature ?? ""),
      priority: normPriority(r.priority),
      mode: r.mode === "manual" ? "manual" : "auto",
      precondition: [r.precondition, Array.isArray(r.pre) ? `测试数据 ${r.pre.join("、")}` : ""].filter(Boolean).join("；"),
      steps: [...steps, ...expects].filter(Boolean),
      expected: expectedText,
    };
  });
  return { cases };
}

// ---------- XML（TestLink） ----------

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

function parseTestLinkXml(text: string) {
  const blocks = text.match(/<testcase\b[\s\S]*?<\/testcase>/gi) || [];
  if (!blocks.length) return { cases: [], error: "没有找到 <testcase>（目前支持 TestLink 导出的 XML）" };
  const cases = blocks.slice(0, MAX_ROWS).map((b) => {
    const name = b.match(/<testcase\b[^>]*\bname="([^"]*)"/i)?.[1] || decodeXml(tag(b, "name"));
    const steps: TestStep[] = [];
    const expected: string[] = [];
    for (const st of b.match(/<step\b[\s\S]*?<\/step>/gi) || []) {
      for (const l of splitLines(decodeXml(tag(st, "actions")))) {
        const s = parseStepLine(l);
        if (s) steps.push(s);
      }
      const e = decodeXml(tag(st, "expectedresults"));
      if (e) expected.push(e);
    }
    const imp = decodeXml(tag(b, "importance"));
    return {
      code: decodeXml(tag(b, "externalid")) ? `TC-${decodeXml(tag(b, "externalid")).replace(/\D/g, "")}` : "",
      title: decodeXml(name),
      priority: imp === "3" ? "P0" : imp === "2" ? "P1" : imp === "1" ? "P2" : "P2",
      mode: decodeXml(tag(b, "execution_type")) === "2" ? "auto" : "manual",
      precondition: decodeXml(tag(b, "preconditions")) || decodeXml(tag(b, "summary")),
      steps,
      expected: expected.join("；"),
    };
  });
  return { cases };
}

// ---------- Excel / XMind（zip） ----------

function unzip(buf: Uint8Array) {
  try {
    return unzipSync(buf, { filter: (f) => f.originalSize < 20 * 1024 * 1024 && /\.(xml|json|rels)$/i.test(f.name) });
  } catch {
    return null;
  }
}

const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function parseXlsx(buf: Uint8Array) {
  const files = unzip(buf);
  if (!files) return { cases: [], error: "不是有效的 .xlsx 文件" };
  const shared = files["xl/sharedStrings.xml"] ? (strFromU8(files["xl/sharedStrings.xml"]).match(/<si\b[\s\S]*?<\/si>/g) || []).map((si) => decodeXml((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<\/?t\b[^>]*>/g, "")).join(""))) : [];
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) return { cases: [], error: "Excel 里没有工作表" };
  const xml = strFromU8(files[sheetName]);
  const rows: string[][] = [];
  for (const r of (xml.match(/<row\b[\s\S]*?<\/row>/g) || []).slice(0, MAX_ROWS + 1)) {
    const row: string[] = [];
    for (const c of r.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = c.match(/\bt="(\w+)"/)?.[1];
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = c.match(/<is>([\s\S]*?)<\/is>/)?.[1];
      const val = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? decodeXml((inline || "").replace(/<\/?t\b[^>]*>/g, "")) : decodeXml(v ?? "");
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return fromTable(rows);
}

type Topic = { title?: string; children?: { attached?: Topic[] }; markers?: { markerId?: string }[] };

function parseXmind(buf: Uint8Array) {
  const files = unzip(buf);
  if (!files) return { cases: [], error: "不是有效的 .xmind 文件" };
  let root: Topic | null = null;
  if (files["content.json"]) {
    try {
      root = (JSON.parse(strFromU8(files["content.json"])) as { rootTopic?: Topic }[])[0]?.rootTopic || null;
    } catch {
      root = null;
    }
  } else if (files["content.xml"]) {
    // XMind 8：把 <topic><title>…</title><children><topics>…</topics></children></topic> 转成同样的结构
    const xml = strFromU8(files["content.xml"]);
    const parseTopic = (s: string): Topic => {
      const title = decodeXml(s.match(/^<topic\b[^>]*>\s*<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "");
      const inner = s.replace(/^<topic\b[^>]*>/, "").replace(/<\/topic>$/, "");
      const kids: Topic[] = [];
      let depth = 0;
      let start = -1;
      const re = /<topic\b[^>]*>|<\/topic>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inner))) {
        if (m[0].startsWith("</")) {
          depth--;
          if (depth === 0 && start >= 0) kids.push(parseTopic(inner.slice(start, re.lastIndex)));
        } else {
          if (depth === 0) start = m.index;
          depth++;
        }
      }
      return { title, children: { attached: kids } };
    };
    const first = xml.match(/<topic\b[\s\S]*<\/topic>/)?.[0];
    root = first ? parseTopic(first) : null;
  }
  if (!root) return { cases: [], error: "XMind 里没有找到思维导图" };
  const kids = (t: Topic) => t.children?.attached || [];
  const pri = (t: Topic) => {
    const m = (t.markers || []).map((x) => x.markerId || "").find((x) => /^priority-\d/.test(x));
    return m ? `P${Math.min(3, Number(m.split("-")[1]) - 1)}` : "P2";
  };
  const toCase = (t: Topic, module: string): Raw => {
    const steps: TestStep[] = [];
    const expected: string[] = [];
    for (const s of kids(t)) {
      const st = parseStepLine(s.title || "");
      if (st) steps.push(st);
      for (const e of kids(s)) if (e.title) expected.push(e.title.trim());
    }
    const title = (t.title || "").replace(/^tc[-_:：\s]*/i, "").trim();
    return { title: module && !title.startsWith(module) ? `${module} · ${title}` : title, priority: pri(t), mode: "manual", steps, expected: expected.join("；") };
  };
  // 有三层以上：中心 › 模块 › 用例 › 步骤 › 预期；否则 中心 › 用例 › 步骤 › 预期
  const depth = (t: Topic): number => 1 + Math.max(0, ...kids(t).map(depth));
  const cases: Raw[] = [];
  for (const top of kids(root)) {
    if (depth(top) >= 4) for (const c of kids(top)) cases.push(toCase(c, (top.title || "").trim()));
    else cases.push(toCase(top, ""));
  }
  return { cases: cases.slice(0, MAX_ROWS) };
}

// ---------- 入口 ----------

export function detectFormat(fileName: string, text: string): ImportFormat {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
  for (const f of IMPORT_FORMATS) if ((f.ext as readonly string[]).includes(ext)) return f.key;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return "xml";
  if (/^\s*\|.*\|/m.test(t) && /^\s*\|[\s:|-]+\|\s*$/m.test(t)) return "md";
  if (/^(cases|meta|env)\s*:/m.test(t) || /^\s*-\s+(id|title)\s*:/m.test(t)) return "yaml";
  return "csv";
}

/** 导入：给文本（CSV / JSON / YAML / Markdown / XML）或文件字节（xlsx / xmind） */
export function parseImport(input: { text?: string; bytes?: Uint8Array; fileName?: string; format?: string }): { cases: TestCase[]; format: ImportFormat; error?: string } {
  const text = input.text ?? "";
  const format = (IMPORT_FORMATS.some((f) => f.key === input.format) ? input.format : detectFormat(input.fileName || "", text)) as ImportFormat;
  if ((format === "xlsx" || format === "xmind") && !input.bytes) return { cases: [], format, error: "请选择文件上传" };
  if (format !== "xlsx" && format !== "xmind" && !text.trim()) return { cases: [], format, error: "内容是空的" };
  let r: { cases: Raw[]; error?: string };
  if (format === "json") {
    const doc = sanitizeCases(text);
    return doc ? { cases: doc.cases, format } : { cases: [], format, error: "JSON 格式不对" };
  } else if (format === "yaml") r = parseYaml(text);
  else if (format === "md") r = parseMarkdown(text);
  else if (format === "xml") r = parseTestLinkXml(text);
  else if (format === "xlsx") r = parseXlsx(input.bytes!);
  else if (format === "xmind") r = parseXmind(input.bytes!);
  else r = fromTable(parseCsv(text));
  if (r.error) return { cases: [], format, error: r.error };
  const cases = r.cases.map((c, i) => cleanCase(c, i)).filter((c): c is TestCase => !!c);
  return { cases, format };
}
