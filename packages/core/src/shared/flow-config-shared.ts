import { REQ_STATUS } from "./constants";
import { LOCKED_REQ_STATUSES, parseHiddenStatuses } from "./req-stages-shared";

/**
 * T41 研发流程配置（前后端共用，不能引 prisma）。
 * 状态 key 固定（自动流转、交付、评审都按 key 判断），可配置的是：停用哪些状态、状态显示名称、是否必须评审。
 * 三层：系统「阶段管理」（全系统底线）→ 企业默认 → 项目覆盖（企业允许时）。停用只能逐层收紧，下层不能重新启用上层停用的状态。
 * 没有任何配置 = 默认流程：沿用系统阶段设置、不强制评审，和改造前完全一样。
 */

export type FlowMode = "kanban" | "scrum" | "phase";
export const FLOW_MODES: { key: FlowMode; label: string; desc: string }[] = [
  { key: "kanban", label: "看板", desc: "持续流动，按发版节奏上线（原来的方式）" },
  { key: "scrum", label: "Scrum 迭代", desc: "按 1–4 周迭代规划需求；看板默认只看当前迭代，迭代结束时未完成的一键挪到下一期" },
  { key: "phase", label: "阶段式", desc: "按 需求 → 设计 → 开发 → 测试 → 上线 的里程碑推进，项目概览显示各阶段进度" },
];

/**
 * T43 关卡：改状态时检查（看板拖动、状态菜单、开放接口、自动推进）。key = 「进入哪一段:检查什么」。
 * 企业勾选的项目不能去掉；企业允许时项目可以再加。
 */
export const GATE_DEFS = [
  { key: "design:prd", stage: "design", label: "PRD 已确认" },
  { key: "dev:prd", stage: "dev", label: "PRD 已确认" },
  { key: "dev:ui", stage: "dev", label: "有 UI 设计稿" },
  { key: "dev:prototype", stage: "dev", label: "有原型" },
  { key: "dev:designTasks", stage: "dev", label: "设计任务全部完成" },
  { key: "test:devTasks", stage: "test", label: "开发任务全部完成" },
  { key: "test:merged", stage: "test", label: "代码已合并（项目绑定了代码仓库时）" },
  { key: "test:cases", stage: "test", label: "测试用例已确认" },
  { key: "online:testPassed", stage: "online", label: "最近一轮测试全部通过" },
  { key: "online:report", stage: "online", label: "有测试报告" },
  { key: "online:noBlockers", stage: "online", label: "没有未解决的致命 / 严重 Bug" },
] as const;
export type GateKey = (typeof GATE_DEFS)[number]["key"];
export const GATE_STAGES: { key: string; label: string }[] = [
  { key: "design", label: "进入设计" },
  { key: "dev", label: "进入开发" },
  { key: "test", label: "进入测试" },
  { key: "online", label: "上线" },
];
const GATE_KEYS = GATE_DEFS.map((g) => g.key as string);

export function parseGates(raw: unknown): GateKey[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = [];
    }
  }
  if (!Array.isArray(v)) return [];
  return GATE_KEYS.filter((k) => (v as unknown[]).map(String).includes(k)) as GateKey[];
}

export const isFlowMode = (v: unknown): v is FlowMode => v === "kanban" || v === "scrum" || v === "phase";

export type EnterpriseFlow = {
  hidden: string[];
  labels: Record<string, string>;
  reviewRequired: boolean;
  allowProjectStages: boolean;
  allowProjectReview: boolean;
  mode: FlowMode;
  designStage: boolean;
  gates: GateKey[];
  allowProjectMode: boolean;
  allowProjectGates: boolean;
};
export type ProjectFlow = { hidden: string[]; reviewRequired: boolean | null; mode?: FlowMode | null; designStage?: boolean | null; gates?: GateKey[] };
export type EffectiveFlow = {
  hidden: string[];
  labels: Record<string, string>;
  reviewRequired: boolean;
  /** 评审要求来自哪一层 */
  reviewSource: "default" | "enterprise" | "project";
  mode: FlowMode;
  designStage: boolean;
  gates: GateKey[];
};

export const DEFAULT_ENTERPRISE_FLOW: EnterpriseFlow = {
  hidden: [],
  labels: {},
  reviewRequired: false,
  allowProjectStages: true,
  allowProjectReview: true,
  mode: "kanban",
  designStage: false,
  gates: [],
  allowProjectMode: true,
  allowProjectGates: true,
};

const KEYS = REQ_STATUS.map((s) => s.key as string);
const DEFAULT_LABEL: Record<string, string> = Object.fromEntries(REQ_STATUS.map((s) => [s.key, s.label]));
export const FLOW_LABEL_MAX = 12;

/** 存储值 → 显示名称：只留存在的 key，去空白、限长，和默认名相同的去掉；名称不能重复 */
export function parseLabels(raw: unknown): Record<string, string> {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const s = String((v as Record<string, unknown>)[k] ?? "").replace(/\s+/g, " ").trim().slice(0, FLOW_LABEL_MAX);
    if (s && s !== DEFAULT_LABEL[k]) out[k] = s;
  }
  return out;
}

/** 名称冲突（两个状态显示成同一个名字）时返回提示，否则 null */
export function labelConflict(labels: Record<string, string>): string | null {
  const seen = new Map<string, string>();
  for (const k of KEYS) {
    const name = labels[k] || DEFAULT_LABEL[k];
    const prev = seen.get(name);
    if (prev) return `「${name}」同时用于两个状态，请换一个名称`;
    seen.set(name, k);
  }
  return null;
}

export function flowStatusLabel(key: string, labels?: Record<string, string> | null) {
  return labels?.[key] || DEFAULT_LABEL[key] || key;
}

const union = (...lists: (readonly string[] | undefined | null)[]) => parseHiddenStatuses(Array.from(new Set(lists.flatMap((l) => l || []))));

/**
 * 合成生效的流程。
 * @param ent 企业配置；null = 项目不属于任何企业（只有系统管理员可见），这时项目覆盖不受限制
 */
export function resolveFlow(systemHidden: readonly string[], ent: EnterpriseFlow | null, proj: ProjectFlow | null): EffectiveFlow {
  const allowStages = ent ? ent.allowProjectStages : true;
  const allowReview = ent ? ent.allowProjectReview : true;
  const allowMode = ent ? ent.allowProjectMode : true;
  const allowGates = ent ? ent.allowProjectGates : true;
  // T43：研发模式、设计环节按 项目（企业允许时）→ 企业 → 默认（看板、不启用设计环节）
  const mode: FlowMode = (allowMode && proj?.mode) || ent?.mode || "kanban";
  const designStage = allowMode && proj?.designStage != null ? proj.designStage : Boolean(ent?.designStage);
  // 设计环节没启用时「设计中」视为停用；启用了但系统 / 企业 / 项目停用了它，仍按停用
  let hidden = union(systemHidden, ent?.hidden, allowStages ? proj?.hidden : null, designStage ? null : ["req_design"]);
  if (!designStage) hidden = Array.from(new Set([...hidden, "req_design"]));
  const gates = parseGates([...(ent?.gates || []), ...(allowGates ? proj?.gates || [] : [])]);
  const base = { hidden, labels: ent?.labels || {}, mode, designStage: designStage && !hidden.includes("req_design"), gates };
  if (proj && proj.reviewRequired !== null && allowReview) return { ...base, reviewRequired: proj.reviewRequired, reviewSource: "project" };
  if (ent?.reviewRequired) return { ...base, reviewRequired: true, reviewSource: "enterprise" };
  return { ...base, reviewRequired: false, reviewSource: ent ? "enterprise" : "default" };
}

const STAGE_OF: Record<string, string> = Object.fromEntries(REQ_STATUS.map((s) => [s.key, s.stage]));

/** 这次改状态是否要过评审关：从需求阶段进入开发 / 测试 / 上线；启用设计环节时进入「设计中」也要（T43） */
export function crossesReviewGate(from: string, to: string) {
  if (to === "req_design" && from !== "req_design" && STAGE_OF[from] === "req") return true;
  return STAGE_OF[from] === "req" && !["req", "cancelled"].includes(STAGE_OF[to] || "");
}

/** 这次改状态要检查哪一段的关卡（T43）：进入设计 / 开发 / 测试 / 上线；往回走、取消不检查 */
export function gateStageFor(from: string, to: string): "design" | "dev" | "test" | "online" | null {
  const order = REQ_STATUS.map((s) => s.key as string);
  if (to === "cancelled" || order.indexOf(to) <= order.indexOf(from)) return null;
  if (to === "req_design") return "design";
  const a = STAGE_OF[from], b = STAGE_OF[to];
  if (b === "dev" && a === "req") return "dev";
  if (b === "test" && (a === "req" || a === "dev")) return "test";
  if (b === "online") return "online";
  return null;
}

export const REVIEW_GATE_MESSAGE = "本项目要求需求评审通过后才能进入开发，请先在需求详情发起需求评审";

/** 企业配置存储行 → 对象 */
type FlowRow = {
  hiddenStatuses: string;
  statusLabels: string;
  reviewRequired: boolean | null;
  allowProjectStages: boolean;
  allowProjectReview: boolean;
  mode?: string | null;
  designStage?: boolean | null;
  gates?: string;
  allowProjectMode?: boolean;
  allowProjectGates?: boolean;
};

export function enterpriseFlowFromRow(row: FlowRow | null): EnterpriseFlow {
  if (!row) return { ...DEFAULT_ENTERPRISE_FLOW };
  return {
    hidden: parseHiddenStatuses(row.hiddenStatuses),
    labels: parseLabels(row.statusLabels),
    reviewRequired: Boolean(row.reviewRequired),
    allowProjectStages: row.allowProjectStages,
    allowProjectReview: row.allowProjectReview,
    mode: isFlowMode(row.mode) ? row.mode : "kanban",
    designStage: Boolean(row.designStage),
    gates: parseGates(row.gates ?? "[]"),
    allowProjectMode: row.allowProjectMode ?? true,
    allowProjectGates: row.allowProjectGates ?? true,
  };
}

export function projectFlowFromRow(row: { hiddenStatuses: string; reviewRequired: boolean | null; mode?: string | null; designStage?: boolean | null; gates?: string } | null): ProjectFlow | null {
  if (!row) return null;
  return { hidden: parseHiddenStatuses(row.hiddenStatuses), reviewRequired: row.reviewRequired, mode: isFlowMode(row.mode) ? row.mode : null, designStage: row.designStage ?? null, gates: parseGates(row.gates ?? "[]") };
}

export { LOCKED_REQ_STATUSES };
