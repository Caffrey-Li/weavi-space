import { prisma } from "@pm-collab/db/prisma";

/** 定额周期起点：day 当天 0 点；week 本周一 0 点；month 本月 1 日 0 点（服务器时区） */
export function periodStart(period: string, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "day") return d;
  if (period === "week") {
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export const PERIOD_LABEL: Record<string, string> = { day: "每天", week: "每周", month: "每月" };

/** 成员的企业定额：个人设置优先，其次企业默认；没有 = 不限 */
export async function quotaFor(enterpriseId: string, userId: string) {
  const rows = await prisma.aiQuota.findMany({ where: { enterpriseId, userId: { in: [userId, ""] } } });
  return rows.find((r) => r.userId === userId) || rows.find((r) => r.userId === "") || null;
}

export async function usedTokens(enterpriseId: string, userId: string, since: Date) {
  const r = await prisma.aiUsage.aggregate({
    where: { enterpriseId, userId, billedTo: "enterprise", createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (r._sum.inputTokens || 0) + (r._sum.outputTokens || 0);
}

/** 剩余额度：null = 不限 */
export async function remainingTokens(enterpriseId: string, userId: string) {
  const q = await quotaFor(enterpriseId, userId);
  if (!q) return { limit: null as number | null, used: 0, remaining: null as number | null, period: null as string | null };
  const used = await usedTokens(enterpriseId, userId, periodStart(q.period));
  return { limit: q.tokenLimit, used, remaining: Math.max(0, q.tokenLimit - used), period: q.period };
}

export async function recordUsage(u: {
  userId: string;
  enterpriseId: string | null;
  credentialId?: string | null;
  billedTo: "user" | "enterprise";
  provider: string;
  model: string;
  feature: string;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  costCents?: number;
}) {
  await prisma.aiUsage.create({ data: { ...u, inputTokens: u.inputTokens || 0, outputTokens: u.outputTokens || 0, images: u.images || 0, costCents: u.costCents || 0 } });
}
