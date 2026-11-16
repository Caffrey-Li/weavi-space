import { sniffImage } from "./upload-guard";
import type { Prisma } from "@prisma/client";
import { getHiddenStatuses } from "./req-stages";
import { remapHiddenStatus } from "./req-stages-shared";
import { titleFromText } from "./title-gen-shared";
import { prisma } from "@pm-collab/db/prisma";
import { alignToProjects } from "./cascade";
import { createHash } from "crypto";
import { linkAttachments } from "./attachments";
import { BUG_STATUS, REQ_STATUS, SEVERITY_LABELS } from "./constants";
import { mapPriority, mapStatus } from "./itr-sync";
import { getAccess, bugWhere, requirementWhere } from "../access";
import { isBugReturn } from "../bugs/write";
import {
  FeishuApiError,
  appendSheetRows,
  cellImages,
  cellText,
  colLetter,
  downloadMedia,
  createBitableRecords,
  listBitableFields,
  listBitableRecords,
  listSheets,
  readSheet,
  readSheetRaw,
  updateBitableRecords,
  writeSheetCells,
  type BitableField,
} from "./feishu-api";

/**
 * 飞书表格 ↔ 需求 / Bug 双向同步（手动触发或单向自动同步，按操作方向决定以谁为准）
 * - 导入到（link.target）：requirement 需求池 / bug Bug；所属项目可不指定（公共池），不指定项目时可以只指定产品。
 *   拉取和回写用同一个范围（同一套路径和字段对应）：回写只写这个范围里的记录，追加也只追加这个范围里的记录。
 * - 拉取：以飞书为准。表格里有、系统里没有的行新建需求；对应上的需求按映射列更新。空单元格不清空系统里的值；表格删掉的行不删需求。
 * - 回写：以系统为准。把对应需求的映射字段写回单元格；可选把项目里表格还没有的需求追加到末尾。
 * - 两个方向都先 preview（只读，列出将变更的行），确认后再 apply（重新计算一次再执行，避免预览后表格又被改）。
 * 行与需求的对应：多维表格用 record_id；电子表格用「第 N 行」，映射了「系统编号」列时优先按编号对应（插行不会错位）。
 */

export const SYNC_FIELDS = [
  { key: "title", label: "标题", required: true },
  { key: "status", label: "状态" },
  { key: "priority", label: "优先级" },
  { key: "product", label: "产品负责人" },
  { key: "frontend", label: "前端负责人" },
  { key: "backend", label: "后端负责人" },
  { key: "qa", label: "测试负责人" },
  { key: "startAt", label: "开始日期" },
  { key: "plannedEndAt", label: "计划完成" },
  { key: "summary", label: "描述" },
  { key: "code", label: "系统编号" },
] as const;
/** 导入到 Bug 时的字段 */
export const BUG_SYNC_FIELDS = [
  { key: "title", label: "标题", required: true },
  { key: "status", label: "状态" },
  { key: "severity", label: "严重程度" },
  { key: "frontend", label: "前端负责人" },
  { key: "backend", label: "后端负责人" },
  { key: "dueAt", label: "截止日期" },
  { key: "summary", label: "描述" },
  { key: "code", label: "系统编号" },
] as const;
export type SyncFieldKey = (typeof SYNC_FIELDS)[number]["key"] | (typeof BUG_SYNC_FIELDS)[number]["key"];
export type FieldDef = { key: SyncFieldKey; label: string; required?: boolean };
const ALL_FIELDS: readonly FieldDef[] = [...SYNC_FIELDS, ...BUG_SYNC_FIELDS.filter((f) => !SYNC_FIELDS.some((x) => x.key === f.key))];
export type Mapping = Partial<Record<SyncFieldKey, string>>;
const LABEL: Record<string, string> = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f.label]));

export type Target = "requirement" | "bug";
export const asTarget = (v: unknown): Target => (v === "bug" ? "bug" : "requirement");
export const TARGET_LABEL: Record<Target, string> = { requirement: "需求池", bug: "Bug" };
export function fieldsFor(target: Target): readonly FieldDef[] {
  return target === "bug" ? BUG_SYNC_FIELDS : SYNC_FIELDS;
}
/** 拉取 / 回写需要的功能点：需求拉取要「新建需求」、回写要「编辑需求」；Bug 两个方向都要「处理 Bug」 */
export function featureFor(target: Target, pull: boolean) {
  return target === "bug" ? "bugs.edit" : pull ? "requirements.create" : "requirements.edit";
}
/** 自动同步：方向和间隔（分钟） */
export const AUTO_EVERY = [15, 30, 60, 180, 720, 1440] as const;
export const asAutoSync = (v: unknown): "off" | "pull" | "push" => (v === "pull" || v === "push" ? v : "off");
export const asAutoEvery = (v: unknown) => {
  const n = Number(v);
  return (AUTO_EVERY as readonly number[]).includes(n) ? n : 60;
};

/** 可以合并多列的字段：标题用「 · 」连接，描述按列分段（含单元格图片） */
export const MULTI_KEYS = ["title", "summary"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];
export type MultiCols = Record<MultiKey, string[]>;

/** mapping 存成 { 字段: 列名 } 或 { 字段: [列名…] }（只有标题、描述可多列）；返回单列视图（多列取第一列）和多列视图 */
export function parseMappingFull(raw: string | null | undefined): { mapping: Mapping; multi: MultiCols; autoTitle: boolean } {
  const mapping: Mapping = {};
  const multi: MultiCols = { title: [], summary: [] };
  let autoTitle = false;
  try {
    const m = JSON.parse(raw || "{}") as Record<string, unknown>;
    autoTitle = m._autoTitle === true;
    for (const f of ALL_FIELDS) {
      const v = m[f.key];
      const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map((x) => x.trim());
      const uniq = Array.from(new Set(list));
      if (!uniq.length) continue;
      if ((MULTI_KEYS as readonly string[]).includes(f.key)) multi[f.key as MultiKey] = uniq.slice(0, 8);
      mapping[f.key] = uniq[0];
    }
  } catch {
    /* 坏数据当作空映射 */
  }
  return { mapping, multi, autoTitle };
}
/** 回写哪些字段：默认只回写状态；合并了多列的标题 / 描述不能回写 */
export const DEFAULT_PUSH: SyncFieldKey[] = ["status"];
export function parsePushFields(raw: string | null | undefined, multi?: MultiCols): SyncFieldKey[] {
  let list: string[] = DEFAULT_PUSH;
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(v)) list = v.filter((x): x is string => typeof x === "string");
  } catch {
    /* 坏数据按默认 */
  }
  return ALL_FIELDS.map((f) => f.key).filter(
    (k) => list.includes(k) && !(multi && (MULTI_KEYS as readonly string[]).includes(k) && multi[k as MultiKey].length > 1),
  );
}

export function parseMapping(raw: string | null | undefined): Mapping {
  return parseMappingFull(raw).mapping;
}
/** 保存用：标题 / 描述多列时存数组，其余存字符串 */
export function serializeMapping(input: Record<string, unknown>): string {
  const out: Record<string, string | string[] | boolean> = {};
  const { mapping, multi, autoTitle } = parseMappingFull(JSON.stringify(input));
  for (const [k, v] of Object.entries(mapping)) out[k] = v as string;
  for (const k of MULTI_KEYS) if (multi[k].length > 1) out[k] = multi[k];
  // 「根据描述自动生成标题」只在对应了描述列时有意义
  if (autoTitle && multi.summary.length) out._autoTitle = true;
  return JSON.stringify(out);
}

// ———————————————————— 统一的表格模型 ————————————————————

type Row = { key: string; label: string; index: number; cells: Record<string, unknown> };
type Table = { kind: "sheet" | "bitable"; columns: string[]; types: Record<string, number>; rows: Row[]; width: number; sheetId?: string; headerRow: number };

/** 表头行：前 10 行里非空单元格最多的那一行（标题行、说明行通常只有一两格），取最靠前的 */
export function detectHeader(matrix: string[][]): number {
  const counts = matrix.slice(0, 10).map((r) => (r || []).filter((c) => c.trim()).length);
  const max = Math.max(0, ...counts);
  const i = counts.findIndex((c) => c >= Math.max(2, Math.ceil(max * 0.6)));
  return i >= 0 ? i : 0;
}

export type LinkLike = { kind: string; token: string; tableId: string; headerRow: number };

export async function loadTable(link: LinkLike): Promise<Table> {
  if (link.kind === "sheet") {
    const sheets = await listSheets(link.token);
    const sheet = sheets.find((s) => s.id === link.tableId) || (link.tableId ? undefined : sheets[0]);
    if (!sheet) throw new FeishuApiError("找不到这张工作表，可能已被删除或改名，请编辑连接重新选择");
    const raw = await readSheetRaw(link.token, sheet);
    const matrix = raw.map((r) => r.map(cellText));
    const h = link.headerRow > 0 ? link.headerRow - 1 : detectHeader(matrix);
    const header = (matrix[h] || []).map((c) => c.trim());
    const columns = header.filter(Boolean);
    const rows: Row[] = [];
    for (let i = h + 1; i < matrix.length; i++) {
      const cells: Record<string, unknown> = {};
      header.forEach((name, ci) => {
        if (name) cells[name] = raw[i]?.[ci] ?? "";
      });
      rows.push({ key: `row:${i + 1}`, label: `第 ${i + 1} 行`, index: i + 1, cells });
    }
    return { kind: "sheet", columns, types: {}, rows, width: header.length, sheetId: sheet.id, headerRow: h + 1 };
  }
  const [fields, records] = await Promise.all([listBitableFields(link.token, link.tableId), listBitableRecords(link.token, link.tableId)]);
  const types: Record<string, number> = {};
  for (const f of fields) types[f.name] = f.type;
  return {
    kind: "bitable",
    columns: fields.map((f: BitableField) => f.name),
    types,
    rows: records.map((r, i) => ({ key: r.id, label: `记录 ${i + 1}`, index: i + 1, cells: r.fields })),
    width: fields.length,
    headerRow: 1,
  };
}

// ———————————————————— 值的读写 ————————————————————

/** 日期一律按服务器本机时区（不写死）：解析出的日期是本地零点，显示 / 比较也按本地日期 */
function dayKey(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDay(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw > 1e11 ? new Date(raw) : raw > 20000 && raw < 80000 ? new Date(Date.UTC(1899, 11, 30 + Math.round(raw), 12)) : null;
  const s = cellText(raw);
  if (/^\d{12,}$/.test(s)) return new Date(Number(s));
  if (/^\d+(\.\d+)?$/.test(s)) return parseDay(Number(s));
  const m = s.match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * 表格里的状态文字 → 需求状态。认不出的返回 null（不当作「需求中」），
 * 兼容问题登记表常见写法：已处理 / 已解决 / 已关闭 → 已上线，处理中 → 开发中，待处理 → 需求中，不采纳 → 已取消
 */
function mapStatusStrict(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/不采纳|不处理|驳回|作废|关闭不改|无需处理/.test(s)) return "cancelled";
  if (/已处理|已解决|已修复|已关闭|已完成|已上线|已发布|完成/.test(s) && !/未完成/.test(s)) return /测试完成/.test(s) ? "test_done" : "online";
  if (/处理中|进行中|修复中|跟进中/.test(s)) return "dev_in_progress";
  if (/待处理|未处理|新提交|待确认|待评估|未开始/.test(s)) return "req_in_progress";
  const m = mapStatus(s);
  return m === "req_in_progress" && !/需求/.test(s) ? null : m;
}
/** 表格里的状态文字 → Bug 状态；认不出返回 null */
function mapBugStatus(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hit = BUG_STATUS.find((b) => b.label === s || b.key === s.toLowerCase());
  if (hit) return hit.key;
  if (/重新打开|重开|复现|reopen/i.test(s)) return "reopened";
  if (/不采纳|不处理|驳回|作废|无需处理|取消|非问题|不是问题/.test(s)) return "cancelled";
  if (/已关闭|关闭|已验证|验证通过|已完成|已上线|已发布/.test(s)) return "closed";
  if (/已处理|已解决|已修复|待验证|待回归/.test(s)) return "resolved";
  if (/处理中|进行中|修复中|跟进中|开发中/.test(s)) return "in_progress";
  if (/待处理|未处理|新提交|新建|待确认|待评估|未开始|打开/.test(s)) return "open";
  return null;
}
/** 表格里的严重程度 / 优先级文字 → Bug 严重程度；认不出返回 null */
function mapSeverity(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hit = Object.entries(SEVERITY_LABELS).find(([k, l]) => s === l || s.toLowerCase() === k);
  if (hit) return hit[0];
  if (/致命|阻塞|blocker|^[sp]0$/i.test(s)) return "blocker";
  if (/严重|紧急|critical|^[sp]1$|高/i.test(s)) return "critical";
  if (/一般|主要|普通|major|^[sp]2$|中/i.test(s)) return "major";
  if (/次要|minor|^[sp]3$|低/i.test(s)) return "minor";
  if (/轻微|建议|提示|trivial|^s4$/i.test(s)) return "trivial";
  return null;
}
const reqStatusLabel = (k: string) => REQ_STATUS.find((s) => s.key === k)?.label || k;
const bugStatusLabel = (k: string) => BUG_STATUS.find((s) => s.key === k)?.label || k;

/** 两种导入目标的差异都收在这里 */
type Spec = {
  target: Target;
  noun: string;
  levelKey: "priority" | "severity";
  slotKeys: readonly SyncFieldKey[];
  dateKeys: readonly ("startAt" | "plannedEndAt" | "dueAt")[];
  mapStatus: (raw: string) => string | null;
  statusLabel: (k: string) => string;
  /** 新建时的初始状态：回写时表格空、记录也还在初始状态的不去填 */
  initialStatus: string;
  doneStatus: string | null;
  mapLevel: (raw: string) => string | null;
  levelLabel: (k: string) => string;
};
const SPECS: Record<Target, Spec> = {
  requirement: {
    target: "requirement",
    noun: "需求",
    levelKey: "priority",
    slotKeys: ["product", "frontend", "backend", "qa"],
    dateKeys: ["startAt", "plannedEndAt"],
    mapStatus: mapStatusStrict,
    statusLabel: reqStatusLabel,
    initialStatus: "req_in_progress",
    doneStatus: "online",
    mapLevel: (raw) => (raw.trim() ? mapPriority(raw) : null),
    levelLabel: (p) => p.toUpperCase(),
  },
  bug: {
    target: "bug",
    noun: "Bug",
    levelKey: "severity",
    slotKeys: ["frontend", "backend"],
    dateKeys: ["dueAt"],
    mapStatus: mapBugStatus,
    statusLabel: bugStatusLabel,
    initialStatus: "open",
    doneStatus: null,
    mapLevel: mapSeverity,
    levelLabel: (k) => SEVERITY_LABELS[k] || k,
  },
};
const splitNames = (s: string) => s.split(/[,，、;；/\s]+/).map((x) => x.trim().replace(/^@/, "")).filter(Boolean);

type UserLite = { id: string; name: string; email: string; feishuOpenId: string | null };
function userIndex(users: UserLite[]) {
  const by = new Map<string, UserLite>();
  for (const u of users) {
    by.set(u.name.trim().toLowerCase(), u);
    by.set(u.email.trim().toLowerCase(), u);
    if (u.feishuOpenId) by.set(u.feishuOpenId, u);
  }
  return (raw: unknown): { user: UserLite | null; text: string } => {
    if (Array.isArray(raw)) {
      for (const p of raw) {
        const o = p as { id?: string; name?: string; email?: string };
        const u = (o.id && by.get(o.id)) || (o.email && by.get(o.email.toLowerCase())) || (o.name && by.get(o.name.toLowerCase()));
        if (u) return { user: u, text: cellText(raw) };
      }
    }
    const text = cellText(raw);
    for (const n of splitNames(text)) {
      const u = by.get(n.toLowerCase());
      if (u) return { user: u, text };
    }
    return { user: null, text };
  };
}

/** 需求 / Bug 统一成同一个形状 */
type Rec = {
  id: string;
  title: string;
  status: string;
  /** 需求的优先级 / Bug 的严重程度 */
  level: string;
  summary: string | null;
  dates: Partial<Record<"startAt" | "plannedEndAt" | "dueAt", Date | null>>;
  actualEndAt: Date | null;
  archivedAt: Date | null;
  slots: { role: string; userId: string; name: string; openId: string | null }[];
};

/** 系统编号：需求「项目编码-XXXX」（公共池用 REQ），Bug「项目编码-BXXXX」（公共池用 BUG） */
const recCode = (target: Target, projectKey: string | null, id: string) =>
  target === "bug" ? `${projectKey || "BUG"}-B${id.slice(-4).toUpperCase()}` : `${projectKey || "REQ"}-${id.slice(-4).toUpperCase()}`;

// ———————————————————— 预览结果 ————————————————————

export type PlanItem = { kind: "create" | "update" | "skip" | "append"; row: string; title: string; detail: string };
export type Plan = {
  direction: "pull" | "push";
  counts: { create: number; update: number; same: number; skip: number; append: number };
  items: PlanItem[];
  /** 本次是否按描述生成标题；canAutoTitle = 对应了描述列，可以切换 */
  autoTitle?: boolean;
  canAutoTitle?: boolean;
};
export type PullOptions = { autoTitle?: boolean };

async function loadContext(linkId: string, opts: PullOptions = {}) {
  const link = await prisma.feishuTableLink.findUnique({ where: { id: linkId } });
  if (!link) throw new FeishuApiError("连接不存在或已删除");
  const spec = SPECS[asTarget(link.target)];
  const project = link.projectId
    ? await prisma.project.findUnique({ where: { id: link.projectId }, select: { id: true, key: true, name: true, productId: true } })
    : null;
  if (link.projectId && !project) throw new FeishuApiError("连接的项目不存在，请编辑连接重新选择项目");
  // 选了项目时跟随项目的产品；没选项目时用连接里指定的产品（可以为空 = 公共池）
  const productId = project ? project.productId : link.productId || null;
  const product = productId ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } }) : null;
  if (!project && link.productId && !product) throw new FeishuApiError("连接的产品不存在，请编辑连接重新选择");
  const pool = spec.target === "bug" ? "公共 Bug" : "公共需求池";
  const scopeLabel = project ? `「${project.name}」` : product ? `「${product.name}」的${pool}` : `「${pool}」`;
  const parsed = parseMappingFull(link.mapping);
  // 只用当前导入目标有的字段
  const allowed = new Set<string>(fieldsFor(spec.target).map((f) => f.key));
  const mapping = Object.fromEntries(Object.entries(parsed.mapping).filter(([k]) => allowed.has(k))) as Mapping;
  const { multi } = parsed;
  // 拉取时可以临时覆盖连接里的默认设置；没有描述列时无从生成
  const autoTitle = multi.summary.length > 0 && (typeof opts.autoTitle === "boolean" ? opts.autoTitle : parsed.autoTitle);
  if (!mapping.title) throw new FeishuApiError("还没有对应「标题」列，请编辑连接补上字段映射");
  const table = await loadTable(link);
  const all: [string, string][] = [
    ...(Object.entries(mapping) as [string, string][]).filter(([k]) => !(MULTI_KEYS as readonly string[]).includes(k)),
    ...MULTI_KEYS.flatMap((k) => multi[k].map((c) => [k, c] as [string, string])),
  ];
  const missing = all.filter(([, col]) => !table.columns.includes(col));
  if (missing.length) throw new FeishuApiError(`表格里找不到这些列：${missing.map(([k, c]) => `${LABEL[k]}→${c}`).join("、")}，请编辑连接更新映射`);
  // 范围：项目里的全部；公共池按产品（或没有产品）并且只取连接创建人所在企业能看到的
  const owner = await prisma.user.findUnique({ where: { id: link.createdById }, select: { id: true, globalRole: true } });
  const access = await getAccess(owner ?? { id: link.createdById, globalRole: "guest" });
  const loadRecs = async (): Promise<Rec[]> => {
    if (spec.target === "bug") {
      const rows = await prisma.bug.findMany({
        where: project ? { projectId: project.id } : { AND: [{ projectId: null, productId }, bugWhere(access)] },
        select: {
          id: true,
          title: true,
          status: true,
          severity: true,
          summary: true,
          dueAt: true,
          archivedAt: true,
          frontendId: true,
          backendId: true,
          frontend: { select: { name: true, feishuOpenId: true } },
          backend: { select: { name: true, feishuOpenId: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        level: b.severity,
        summary: b.summary,
        dates: { dueAt: b.dueAt },
        actualEndAt: null,
        archivedAt: b.archivedAt,
        slots: [
          ...(b.frontendId && b.frontend ? [{ role: "frontend", userId: b.frontendId, name: b.frontend.name, openId: b.frontend.feishuOpenId }] : []),
          ...(b.backendId && b.backend ? [{ role: "backend", userId: b.backendId, name: b.backend.name, openId: b.backend.feishuOpenId }] : []),
        ],
      }));
    }
    const rows = await prisma.requirement.findMany({
      where: project ? { projectId: project.id } : { AND: [{ projectId: null, productId }, requirementWhere(access)] },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        summary: true,
        startAt: true,
        plannedEndAt: true,
        actualEndAt: true,
        archivedAt: true,
        assignees: { select: { role: true, userId: true, user: { select: { name: true, feishuOpenId: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      level: r.priority,
      summary: r.summary,
      dates: { startAt: r.startAt, plannedEndAt: r.plannedEndAt },
      actualEndAt: r.actualEndAt,
      archivedAt: r.archivedAt,
      slots: r.assignees.map((a) => ({ role: a.role, userId: a.userId, name: a.user.name, openId: a.user.feishuOpenId })),
    }));
  };
  const [links, recs, users] = await Promise.all([
    prisma.feishuTableRow.findMany({ where: { linkId } }),
    loadRecs(),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, feishuOpenId: true } }),
  ]);
  const projectKey = project?.key ?? null;
  const codeOf = (id: string) => recCode(spec.target, projectKey, id);
  const recById = new Map(recs.map((r) => [r.id, r]));
  const recByCode = new Map(recs.map((r) => [codeOf(r.id), r]));
  const recByRow = new Map<string, Rec>();
  for (const l of links) {
    const r = recById.get(l.requirementId);
    if (r) recByRow.set(l.rowKey, r);
  }
  // 每行对应的记录：编号列优先，其次已记录的对应关系
  const matched = new Map<string, Rec>();
  for (const row of table.rows) {
    const code = mapping.code ? cellText(row.cells[mapping.code]).toUpperCase() : "";
    const r = (code && recByCode.get(code)) || recByRow.get(row.key);
    if (r && !r.archivedAt) matched.set(row.key, r);
  }
  const sigOf = new Map(links.map((l) => [l.rowKey, l.sig]));
  const pushFields = new Set(parsePushFields(link.pushFields, multi).filter((k) => allowed.has(k)));
  if (autoTitle) pushFields.delete("title"); // 标题是生成的，不回写覆盖表格原文
  const hiddenStatuses = spec.target === "requirement" ? await getHiddenStatuses() : [];
  return {
    link,
    spec,
    project,
    productId,
    scopeLabel,
    codeOf,
    mapping,
    multi,
    autoTitle,
    hiddenStatuses,
    pushFields,
    table,
    links,
    sigOf,
    recs,
    matched,
    findUser: userIndex(users),
  };
}
type Ctx = Awaited<ReturnType<typeof loadContext>>;

// ———————————————————— 拉取（以飞书为准） ————————————————————

type PullChange = { field: SyncFieldKey; from: string; to: string; value: unknown };
type PullRow = { row: Row; req: Rec | null; title: string; changes: PullChange[]; warn: string[] };

function pullRows(ctx: Ctx): { rows: PullRow[]; skipped: PlanItem[]; same: number } {
  const { mapping, multi, autoTitle, table, matched, findUser, sigOf, spec } = ctx;
  const out: PullRow[] = [];
  const skipped: PlanItem[] = [];
  let same = 0;
  for (const row of table.rows) {
    const mappedCols = [...(Object.values(mapping) as string[]), ...multi.summary];
    if (mappedCols.every((c) => !cellText(row.cells[c]) && !cellImages(row.cells[c]).length)) continue; // 空行
    const titleParts: string[] = [];
    for (const c of multi.title) {
      const t = cellText(row.cells[c]).replace(/\s+/g, " ");
      if (t && titleParts[titleParts.length - 1] !== t) titleParts.push(t);
    }
    let title = titleParts.join(" · ").slice(0, 200);
    if (autoTitle) {
      // 根据描述生成 20 字以内的标题；描述为空时退回标题列
      const descText = multi.summary.map((c) => cellText(row.cells[c])).filter(Boolean).join("\n");
      title = titleFromText(descText, spec.target === "bug" ? "bug" : "requirement") || title;
    }
    if (!title) {
      skipped.push({ kind: "skip", row: row.label, title: "（无标题）", detail: `「${multi.title.join("、")}」为空，这一行不会导入` });
      continue;
    }
    const req = matched.get(row.key) || null;
    const changes: PullChange[] = [];
    const warn: string[] = [];
    const add = (field: SyncFieldKey, from: string, to: string, value: unknown) => {
      if (from !== to) changes.push({ field, from, to, value });
    };
    add("title", req?.title || "", title, title);
    if (mapping.status) {
      const raw = cellText(row.cells[mapping.status]);
      const mapped = raw ? spec.mapStatus(raw) : null;
      const st = mapped ? (spec.target === "requirement" ? remapHiddenStatus(mapped, ctx.hiddenStatuses) : mapped) : null;
      if (st) add("status", req ? spec.statusLabel(req.status) : "", spec.statusLabel(st), st);
      else if (raw) warn.push(`状态「${raw}」认不出对应的${spec.noun}状态，未修改`);
    }
    const levelCol = mapping[spec.levelKey];
    if (levelCol) {
      const raw = cellText(row.cells[levelCol]);
      const lv = raw ? spec.mapLevel(raw) : null;
      if (lv) add(spec.levelKey, req ? spec.levelLabel(req.level) : "", spec.levelLabel(lv), lv);
      else if (raw) warn.push(`${LABEL[spec.levelKey]}「${raw}」认不出，未修改`);
    }
    if (multi.summary.length) {
      // 描述：各列按顺序分段（多列时带列名小标题），单元格里的图片一起导入；用签名判断表格这边有没有变
      const parts = multi.summary
        .map((c) => ({ col: c, text: cellText(row.cells[c]), images: cellImages(row.cells[c]).slice(0, 10) }))
        .filter((p) => p.text || p.images.length);
      if (parts.length) {
        const sig = createHash("sha1").update(JSON.stringify(parts.map((p) => [p.col, p.text, p.images.map((i) => i.token)]))).digest("hex");
        if (!req || sigOf.get(row.key) !== sig) {
          const text = parts.map((p) => p.text).filter(Boolean).join("\n\n");
          const imgs = parts.reduce((n, p) => n + p.images.length, 0);
          changes.push({ field: "summary", from: req ? "旧" : "", to: imgs ? `${text ? "文字" : ""}${text ? " + " : ""}${imgs} 张图片` : "文字", value: { text, parts, sig, multi: multi.summary.length > 1 } });
        }
      }
    }
    for (const k of spec.dateKeys) {
      if (!mapping[k]) continue;
      const d = parseDay(row.cells[mapping[k]!]);
      if (d) add(k, dayKey(req?.dates[k]), dayKey(d), d);
    }
    for (const k of spec.slotKeys) {
      if (!mapping[k]) continue;
      const { user, text } = findUser(row.cells[mapping[k]!]);
      if (!text) continue;
      if (!user) {
        warn.push(`${LABEL[k]}「${text}」在系统里找不到，未修改`);
        continue;
      }
      const cur = req?.slots.find((a) => a.role === k);
      add(k, cur?.name || "", user.name, user.id);
    }
    // 新建时标题以外的字段也算「变更」；已有需求只比较有差异的字段
    if (req && !changes.length) {
      same++;
      continue;
    }
    out.push({ row, req, title, changes, warn });
  }
  return { rows: out, skipped, same };
}

const fmtDiff = (c: PullChange) => (c.field === "summary" ? `描述（${c.to}）` : `${LABEL[c.field]} ${c.from || "空"} → ${c.to}`);

export async function previewPull(linkId: string, opts: PullOptions = {}): Promise<Plan> {
  const ctx = await loadContext(linkId, opts);
  const { rows, skipped, same } = pullRows(ctx);
  const items: PlanItem[] = [];
  let create = 0;
  let update = 0;
  for (const r of rows) {
    if (!r.req) {
      create++;
      const extra = r.changes.filter((c) => c.field !== "title").map((c) => (c.field === "summary" ? `${LABEL[c.field]}（${c.to}）` : `${LABEL[c.field]} ${c.to}`));
      items.push({ kind: "create", row: r.row.label, title: r.title, detail: [`新建${ctx.spec.noun}到${ctx.scopeLabel}`, ...extra, ...r.warn].join(" · ") });
    } else {
      update++;
      items.push({ kind: "update", row: r.row.label, title: r.req.title, detail: [...r.changes.map(fmtDiff), ...r.warn].join(" · ") });
    }
  }
  return {
    direction: "pull",
    counts: { create, update, same, skip: skipped.length, append: 0 },
    items: [...items, ...skipped],
    autoTitle: ctx.autoTitle,
    canAutoTitle: ctx.multi.summary.length > 0,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const toHtml = (s: string) => s.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("");

type SummaryValue = { text: string; parts: { col: string; text: string; images: { token: string; name: string; mime: string }[] }[]; sig: string; multi: boolean };

/** 描述 HTML：多列时每列一个小标题；文字按换行分段；图片下载后存成附件，正文里引用 /api/attachments/<id> */
async function summaryHtml(v: SummaryValue, uploaderId: string, ownerType: string, warn: (w: string) => void) {
  const out: string[] = [];
  for (const p of v.parts) {
    if (v.multi) out.push(`<p><strong>${esc(p.col)}</strong></p>`);
    if (p.text) out.push(toHtml(p.text));
    for (const img of p.images) {
      try {
        const file = await downloadMedia(img.token);
        const mime = sniffImage(file.data)?.mime; // 以内容为准，不信返回头
        if (!mime) throw new Error("不是支持的图片格式");
        if (file.data.length > 8 * 1024 * 1024) throw new Error("图片超过 8MB");
        const att = await prisma.attachment.create({
          data: { ownerType, ownerId: null, name: (img.name || "图片").slice(0, 200), mime, size: file.data.length, data: file.data, uploaderId },
          select: { id: true },
        });
        out.push(`<p><img src="/api/attachments/${att.id}" alt="${esc(img.name || "图片")}"></p>`);
      } catch (e) {
        warn(`「${p.col}」里的图片没能导入：${e instanceof Error ? e.message : "下载失败"}`);
      }
    }
  }
  return out.join("");
}

export type RunResult = { created: number; updated: number; skipped: number; appended: number; errors: string[] };

export async function applyPull(linkId: string, actorId: string, opts: PullOptions = {}): Promise<RunResult> {
  const ctx = await loadContext(linkId, opts);
  const { spec } = ctx;
  const isBug = spec.target === "bug";
  const slotKeys = spec.slotKeys as readonly string[];
  const { rows, skipped } = pullRows(ctx);
  const res: RunResult = { created: 0, updated: 0, skipped: skipped.length, appended: 0, errors: skipped.map((s) => `${s.row}：${s.detail}`) };
  for (const r of rows) {
    try {
      const data: Record<string, unknown> = {};
      let sig: string | null | undefined = r.req ? ctx.sigOf.get(r.row.key) : undefined;
      for (const c of r.changes) {
        if (slotKeys.includes(c.field)) continue;
        if (c.field === "summary") {
          const v = c.value as SummaryValue;
          const html = await summaryHtml(v, actorId, spec.target, (w) => res.errors.push(`${r.row.label}：${w}`));
          data.summary = v.text || null;
          data.descriptionHtml = html;
          sig = v.sig;
        } else data[c.field] = c.value;
      }
      const slotChanges = r.changes.filter((c) => slotKeys.includes(c.field));
      let id = r.req?.id;
      if (isBug) {
        // Bug 的负责人是两列；处理人 = 后端负责人，没有后端时取前端
        const owner = (role: string) => String(slotChanges.find((c) => c.field === role)?.value ?? r.req?.slots.find((x) => x.role === role)?.userId ?? "") || null;
        if (slotChanges.length) {
          data.frontendId = owner("frontend");
          data.backendId = owner("backend");
          data.assigneeId = owner("backend") || owner("frontend");
        }
        if (r.req && typeof data.status === "string" && isBugReturn(r.req.status, data.status)) data.reopenCount = { increment: 1 };
        if (!id) {
          const created = await prisma.bug.create({
            data: { ...data, title: r.title, projectId: ctx.project?.id ?? null, productId: ctx.productId, creatorId: actorId } as Prisma.BugUncheckedCreateInput,
            select: { id: true },
          });
          id = created.id;
          res.created++;
        } else if (Object.keys(data).length) {
          await prisma.bug.update({ where: { id }, data });
        }
      } else {
        if (data.status === spec.doneStatus && !r.req?.actualEndAt) data.actualEndAt = new Date();
        if (!id) {
          const created = await prisma.requirement.create({
            data: { ...data, title: r.title, projectId: ctx.project?.id ?? null, productId: ctx.productId, creatorId: actorId } as Prisma.RequirementUncheckedCreateInput,
            select: { id: true },
          });
          id = created.id;
          res.created++;
        } else if (Object.keys(data).length) {
          await prisma.requirement.update({ where: { id }, data });
        }
        for (const c of slotChanges) {
          await prisma.requirementAssignee.upsert({
            where: { requirementId_role: { requirementId: id, role: c.field } },
            create: { requirementId: id, role: c.field, userId: String(c.value) },
            update: { userId: String(c.value) },
          });
        }
      }
      if (typeof data.descriptionHtml === "string") await linkAttachments(id, data.descriptionHtml, spec.target);
      await prisma.feishuTableRow.deleteMany({ where: { linkId, OR: [{ rowKey: r.row.key }, { requirementId: id }] } });
      await prisma.feishuTableRow.create({ data: { linkId, requirementId: id, rowKey: r.row.key, sig: sig ?? null } });
      if (r.req) {
        res.updated++;
        const statusChange = r.changes.find((c) => c.field === "status");
        await prisma.activityLog.create({
          data: {
            entityType: spec.target,
            entityId: id,
            action: statusChange ? "status_changed" : "updated",
            actorId,
            fromValue: statusChange ? JSON.stringify({ status: r.req.status }) : null,
            toValue: statusChange ? JSON.stringify({ status: statusChange.value }) : null,
            message: `飞书表格「${ctx.link.name}」同步：更新了 ${r.changes.map((c) => LABEL[c.field]).join("、")}`,
          },
        });
      } else {
        await prisma.activityLog.create({
          data: { entityType: spec.target, entityId: id, action: "created", actorId, message: `从飞书表格「${ctx.link.name}」${r.row.label}导入` },
        });
      }
      for (const w of r.warn) res.errors.push(`${r.row.label}：${w}`);
    } catch (e) {
      res.errors.push(`${r.row.label}：${e instanceof Error ? e.message : "写入失败"}`);
    }
  }
  if (ctx.project) await alignToProjects([ctx.project.id]);
  return res;
}

// ———————————————————— 回写（以系统为准） ————————————————————

type PushCell = { col: string; from: string; to: string; value: unknown };

function displayPick(ctx: Ctx, col: string, target: string, norm: (s: string) => string, fallback: string) {
  // 沿用这一列已有的写法（如「开发中」「P1」「高」），没有时用系统的写法
  for (const row of ctx.table.rows) {
    const v = cellText(row.cells[col]);
    if (v && norm(v) === target) return v;
  }
  return fallback;
}

function systemCells(ctx: Ctx, req: Rec, current: Record<string, unknown> | null): PushCell[] {
  const { table, spec } = ctx;
  // 只回写勾选的列；追加新行时另外带上标题和系统编号，方便在表格里认出是哪条需求
  const appending = current === null;
  const allow = (k: SyncFieldKey) => ctx.pushFields.has(k) || (appending && (k === "title" || k === "code"));
  const mapping: Mapping = Object.fromEntries(Object.entries(ctx.mapping).filter(([k]) => allow(k as SyncFieldKey))) as Mapping;
  const out: PushCell[] = [];
  const isBitable = table.kind === "bitable";
  const cur = (col: string) => (current ? current[col] : undefined);
  const push = (col: string, fromText: string, toText: string, value: unknown) => {
    if (fromText !== toText) out.push({ col, from: fromText, to: toText, value });
  };
  const fmtDate = (col: string, d: Date) => {
    const k = dayKey(d);
    if (isBitable && table.types[col] === 5) return { text: k, value: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
    const sample = ctx.table.rows.map((r) => cellText(r.cells[col])).find(Boolean) || "";
    const t = sample.includes("/") ? k.replace(/-/g, "/") : k;
    return { text: k, value: t };
  };
  // 合并了多列的标题 / 描述没法拆回去，回写时跳过
  if (mapping.title && (ctx.multi.title.length === 1 || appending)) push(mapping.title, cellText(cur(mapping.title)), req.title, req.title);
  if (mapping.status) {
    const c = cellText(cur(mapping.status));
    // 表格里是空的、需求也还停在初始的「需求中」时不去填；其余只在含义不同时才写
    const skipBlank = !c && req.status === spec.initialStatus && !appending;
    if (!skipBlank && (!c || spec.mapStatus(c) !== req.status)) {
      const v = displayPick(ctx, mapping.status, req.status, (x) => spec.mapStatus(x) || "", spec.statusLabel(req.status));
      push(mapping.status, c, v, v);
    }
  }
  const levelCol = mapping[spec.levelKey];
  if (levelCol) {
    const c = cellText(cur(levelCol));
    if (!c || spec.mapLevel(c) !== req.level) {
      const v = displayPick(ctx, levelCol, req.level, (x) => spec.mapLevel(x) || "", spec.levelLabel(req.level));
      const numeric = isBitable && table.types[levelCol] === 2 && spec.levelKey === "priority";
      push(levelCol, c, v, numeric ? Number(req.level.slice(1)) : v);
    }
  }
  if (mapping.summary && ctx.multi.summary.length === 1 && req.summary && !cellImages(cur(mapping.summary)).length) push(mapping.summary, cellText(cur(mapping.summary)), req.summary, req.summary);
  for (const k of spec.dateKeys) {
    const col = mapping[k];
    const d = req.dates[k];
    if (!col || !d) continue;
    const curDay = dayKey(parseDay(cur(col)));
    const f = fmtDate(col, d);
    if (curDay !== f.text) out.push({ col, from: curDay, to: f.text, value: f.value });
  }
  for (const k of spec.slotKeys) {
    const col = mapping[k];
    const a = req.slots.find((x) => x.role === k);
    if (!col || !a) continue;
    const c = cellText(cur(col));
    if (splitNames(c).includes(a.name)) continue;
    if (isBitable && table.types[col] === 11) {
      if (!a.openId) continue; // 人员字段只能写飞书账号；没用飞书登录过的人跳过
      out.push({ col, from: c, to: a.name, value: [{ id: a.openId }] });
    } else out.push({ col, from: c, to: a.name, value: a.name });
  }
  if (mapping.code) {
    const code = ctx.codeOf(req.id);
    push(mapping.code, cellText(cur(mapping.code)), code, code);
  }
  return out;
}

function pushPlan(ctx: Ctx) {
  const updates: { row: Row; req: Rec; cells: PushCell[] }[] = [];
  let same = 0;
  for (const row of ctx.table.rows) {
    const req = ctx.matched.get(row.key);
    if (!req) continue;
    const cells = systemCells(ctx, req, row.cells);
    if (cells.length) updates.push({ row, req, cells });
    else same++;
  }
  const linkedIds = new Set(Array.from(ctx.matched.values()).map((r) => r.id));
  const appends = ctx.link.appendOnPush ? ctx.recs.filter((r) => !r.archivedAt && !linkedIds.has(r.id)) : [];
  return { updates, appends, same };
}

export async function previewPush(linkId: string): Promise<Plan> {
  const ctx = await loadContext(linkId);
  const { updates, appends, same } = pushPlan(ctx);
  const colLabel = (col: string) => {
    const k = (Object.keys(ctx.mapping) as SyncFieldKey[]).find((x) => ctx.mapping[x] === col);
    return k ? LABEL[k] : col;
  };
  const items: PlanItem[] = [
    ...updates.map((u) => ({
      kind: "update" as const,
      row: u.row.label,
      title: u.req.title,
      detail: u.cells.map((c) => (colLabel(c.col) === "描述" ? "描述" : `${c.col} ${c.from || "空"} → ${c.to}`)).join(" · "),
    })),
    ...appends.map((r) => ({ kind: "append" as const, row: "末尾", title: r.title, detail: `追加一行 · ${ctx.spec.statusLabel(r.status)} · ${ctx.spec.levelLabel(r.level)}` })),
  ];
  return { direction: "push", counts: { create: 0, update: updates.length, same, skip: 0, append: appends.length }, items };
}

export async function applyPush(linkId: string): Promise<RunResult> {
  const ctx = await loadContext(linkId);
  const { updates, appends } = pushPlan(ctx);
  const res: RunResult = { created: 0, updated: 0, skipped: 0, appended: 0, errors: [] };
  const { link, table } = ctx;
  if (table.kind === "sheet") {
    const header = table.columns;
    // 列字母要按原始表头位置算：重新读一次表头位置
    const matrix = await readSheet(link.token, { id: table.sheetId!, title: "", rows: table.headerRow, cols: Math.max(table.width, 1) });
    const headerRow = matrix[table.headerRow - 1] || [];
    const colIdx = (name: string) => headerRow.findIndex((h) => h.trim() === name);
    const cells: { range: string; value: string }[] = [];
    for (const u of updates) {
      for (const c of u.cells) {
        const ci = colIdx(c.col);
        if (ci >= 0) cells.push({ range: `${table.sheetId}!${colLetter(ci)}${u.row.index}:${colLetter(ci)}${u.row.index}`, value: String(c.value ?? "") });
      }
    }
    await writeSheetCells(link.token, cells);
    res.updated = updates.length;
    for (const u of updates) {
      await prisma.feishuTableRow.deleteMany({ where: { linkId, OR: [{ rowKey: u.row.key }, { requirementId: u.req.id }] } });
      await prisma.feishuTableRow.create({ data: { linkId, requirementId: u.req.id, rowKey: u.row.key } });
    }
    if (appends.length) {
      const width = headerRow.length || header.length;
      const values = appends.map((r) => {
        const line = new Array(width).fill("");
        for (const c of systemCells(ctx, r, null)) {
          const ci = colIdx(c.col);
          if (ci >= 0) line[ci] = String(c.value ?? "");
        }
        return line;
      });
      const rowNos = await appendSheetRows(link.token, table.sheetId!, width, values);
      for (let i = 0; i < appends.length; i++) {
        if (!rowNos[i]) continue;
        await prisma.feishuTableRow.deleteMany({ where: { linkId, OR: [{ rowKey: `row:${rowNos[i]}` }, { requirementId: appends[i].id }] } });
        await prisma.feishuTableRow.create({ data: { linkId, requirementId: appends[i].id, rowKey: `row:${rowNos[i]}` } });
      }
      res.appended = appends.length;
    }
  } else {
    await updateBitableRecords(
      link.token,
      link.tableId,
      updates.map((u) => ({ id: u.row.key, fields: Object.fromEntries(u.cells.map((c) => [c.col, c.value])) })),
    );
    res.updated = updates.length;
    for (const u of updates) {
      await prisma.feishuTableRow.deleteMany({ where: { linkId, OR: [{ rowKey: u.row.key }, { requirementId: u.req.id }] } });
      await prisma.feishuTableRow.create({ data: { linkId, requirementId: u.req.id, rowKey: u.row.key } });
    }
    if (appends.length) {
      const ids = await createBitableRecords(
        link.token,
        link.tableId,
        appends.map((r) => Object.fromEntries(systemCells(ctx, r, null).map((c) => [c.col, c.value]))),
      );
      for (let i = 0; i < appends.length; i++) {
        if (!ids[i]) continue;
        await prisma.feishuTableRow.deleteMany({ where: { linkId, requirementId: appends[i].id } });
        await prisma.feishuTableRow.create({ data: { linkId, requirementId: appends[i].id, rowKey: ids[i] } });
      }
      res.appended = appends.length;
    }
  }
  return res;
}

