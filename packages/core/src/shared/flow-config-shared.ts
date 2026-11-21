import { REQ_STATUS } from "./constants";
import { LOCKED_REQ_STATUSES, parseHiddenStatuses } from "./req-stages-shared";

/**
 * T41 研发流程配置（前后端共用，不能引 prisma）。
 * 状态 key 固定（自动流转、交付、评审都按 key 判断），可配置的是：停用哪些状态、状态显示名称、是否必须评审。
 * 三层：系统「阶段管理」（全系统底线）→ 企业默认 → 项目覆盖（企业允许时）。停用只能逐层收紧，下层不能重新启用上层停用的状态。
 * 没有任何配置 = 默认流程：沿用系统阶段设置、不强制评审，和改造前完全一样。
 */

export type EnterpriseFlow = {
  hidden: string[];
  labels: Record<string, string>;
  reviewRequired: boolean;
  allowProjectStages: boolean;
  allowProjectReview: boolean;
};
export type ProjectFlow = { hidden: string[]; reviewRequired: boolean | null };
export type EffectiveFlow = {
  hidden: string[];
  labels: Record<string, string>;
  reviewRequired: boolean;
  /** 评审要求来自哪一层 */
  reviewSource: "default" | "enterprise" | "project";
};

export const DEFAULT_ENTERPRISE_FLOW: EnterpriseFlow = { hidden: [], labels: {}, reviewRequired: false, allowProjectStages: true, allowProjectReview: true };

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
  const hidden = union(systemHidden, ent?.hidden, allowStages ? proj?.hidden : null);
  if (proj && proj.reviewRequired !== null && allowReview) return { hidden, labels: ent?.labels || {}, reviewRequired: proj.reviewRequired, reviewSource: "project" };
  if (ent?.reviewRequired) return { hidden, labels: ent.labels, reviewRequired: true, reviewSource: "enterprise" };
  return { hidden, labels: ent?.labels || {}, reviewRequired: false, reviewSource: ent ? "enterprise" : "default" };
}

const STAGE_OF: Record<string, string> = Object.fromEntries(REQ_STATUS.map((s) => [s.key, s.stage]));

/** 这次改状态是否要过评审关：从需求阶段进入开发 / 测试 / 上线 */
export function crossesReviewGate(from: string, to: string) {
  return STAGE_OF[from] === "req" && !["req", "cancelled"].includes(STAGE_OF[to] || "");
}

export const REVIEW_GATE_MESSAGE = "本项目要求需求评审通过后才能进入开发，请先在需求详情发起需求评审";

/** 企业配置存储行 → 对象 */
export function enterpriseFlowFromRow(row: { hiddenStatuses: string; statusLabels: string; reviewRequired: boolean | null; allowProjectStages: boolean; allowProjectReview: boolean } | null): EnterpriseFlow {
  if (!row) return { ...DEFAULT_ENTERPRISE_FLOW };
  return {
    hidden: parseHiddenStatuses(row.hiddenStatuses),
    labels: parseLabels(row.statusLabels),
    reviewRequired: Boolean(row.reviewRequired),
    allowProjectStages: row.allowProjectStages,
    allowProjectReview: row.allowProjectReview,
  };
}

export function projectFlowFromRow(row: { hiddenStatuses: string; reviewRequired: boolean | null } | null): ProjectFlow | null {
  if (!row) return null;
  return { hidden: parseHiddenStatuses(row.hiddenStatuses), reviewRequired: row.reviewRequired };
}

export { LOCKED_REQ_STATUSES };
