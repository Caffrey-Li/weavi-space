import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { openText, sealText } from "../shared/secure-config";
import { managedEnterprise } from "../ai/credentials";

/**
 * 小围动手预算（T27 二期）：企业超管按企业调整，存 enterprise_settings（key = agent_budget）。
 * 系统组织的账号、没设置过的企业用默认值。全系统同时运行的任务数是系统常量（loop.ts 的 MAX_CONCURRENT），不归企业管。
 */
export type AgentBudget = {
  /** 每个任务最多调用几次模型 */
  maxSteps: number;
  /** 每个任务最多用多少 token */
  maxTokens: number;
  /** 每人同时进行（排队 / 运行 / 等确认）的任务数 */
  maxActive: number;
  /** 全企业每天最多运行几次自动化规则 */
  ruleRunsPerDay: number;
  /** 是否允许成员建自动化规则 */
  allowRules: boolean;
};

export const DEFAULT_BUDGET: AgentBudget = { maxSteps: 30, maxTokens: 200_000, maxActive: 3, ruleRunsPerDay: 100, allowRules: true };
export const BUDGET_RANGE = {
  maxSteps: [5, 60],
  maxTokens: [10_000, 2_000_000],
  maxActive: [1, 10],
  ruleRunsPerDay: [0, 1000],
} as const;
const KEY = "agent_budget";

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

export function normalizeBudget(raw: unknown): AgentBudget {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    maxSteps: clampInt(r.maxSteps, BUDGET_RANGE.maxSteps, DEFAULT_BUDGET.maxSteps),
    maxTokens: clampInt(r.maxTokens, BUDGET_RANGE.maxTokens, DEFAULT_BUDGET.maxTokens),
    maxActive: clampInt(r.maxActive, BUDGET_RANGE.maxActive, DEFAULT_BUDGET.maxActive),
    ruleRunsPerDay: clampInt(r.ruleRunsPerDay, BUDGET_RANGE.ruleRunsPerDay, DEFAULT_BUDGET.ruleRunsPerDay),
    allowRules: r.allowRules === undefined ? DEFAULT_BUDGET.allowRules : r.allowRules === true,
  };
}

/** 校验输入：超出范围直接报错（不悄悄改成边界值） */
export function validateBudget(raw: Record<string, unknown>): { budget: AgentBudget } | { error: string } {
  const names: Record<keyof typeof BUDGET_RANGE, string> = { maxSteps: "每个任务最多步数", maxTokens: "每个任务最多 token", maxActive: "每人同时进行的任务", ruleRunsPerDay: "自动化规则每天最多运行" };
  for (const k of Object.keys(BUDGET_RANGE) as (keyof typeof BUDGET_RANGE)[]) {
    const n = Number(raw[k]);
    const [lo, hi] = BUDGET_RANGE[k];
    if (!Number.isInteger(n) || n < lo || n > hi) return { error: `${names[k]}要是 ${lo.toLocaleString()}～${hi.toLocaleString()} 之间的整数` };
  }
  return { budget: normalizeBudget({ ...raw, allowRules: raw.allowRules !== false }) };
}

export async function budgetFor(enterpriseId: string | null | undefined): Promise<AgentBudget> {
  if (!enterpriseId) return DEFAULT_BUDGET;
  const row = await prisma.enterpriseSetting.findUnique({ where: { enterpriseId_key: { enterpriseId, key: KEY } } });
  const plain = openText(row?.valueEnc);
  if (!plain) return DEFAULT_BUDGET;
  try {
    return normalizeBudget(JSON.parse(plain));
  } catch {
    return DEFAULT_BUDGET;
  }
}

export function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 今天这个企业的自动化规则已经运行了几次（按规则所属企业统计） */
export async function ruleRunsToday(enterpriseId: string | null, now = new Date()) {
  return prisma.agentTask.count({ where: { source: "rule", createdAt: { gte: startOfToday(now) }, rule: { enterpriseId } } });
}

/** 模型管理页：企业超管看 / 改本企业预算（系统超管可选企业） */
export async function budgetGET(session: SessionUser, enterpriseWanted: string | null) {
  const ent = await managedEnterprise(session, enterpriseWanted);
  if (!ent.current) return result({ budget: null });
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const [budget, runsToday, month] = await Promise.all([
    budgetFor(ent.current.id),
    ruleRunsToday(ent.current.id),
    prisma.aiUsage.aggregate({ where: { enterpriseId: ent.current.id, feature: "agent", createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  const monthTokens = (month._sum.inputTokens || 0) + (month._sum.outputTokens || 0);
  return result({ budget: { enterpriseId: ent.current.id, enterpriseName: ent.current.name, ...budget, runsToday, monthTokens, defaults: DEFAULT_BUDGET, range: BUDGET_RANGE } });
}

export async function budgetPUT(session: SessionUser, body: Record<string, unknown>) {
  const ent = await managedEnterprise(session, String(body.enterpriseId || ""));
  if (!ent.current || ent.current.id !== body.enterpriseId) return result({ error: "只有企业超管可以调整预算" }, { status: 403 });
  const v = validateBudget(body);
  if ("error" in v) return result({ error: v.error }, { status: 400 });
  const value = sealText(JSON.stringify(v.budget));
  await prisma.enterpriseSetting.upsert({
    where: { enterpriseId_key: { enterpriseId: ent.current.id, key: KEY } },
    create: { enterpriseId: ent.current.id, key: KEY, valueEnc: value, updatedById: session.id },
    update: { valueEnc: value, updatedById: session.id },
  });
  return budgetGET(session, ent.current.id);
}
