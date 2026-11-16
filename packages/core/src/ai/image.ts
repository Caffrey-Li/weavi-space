import { prisma } from "@pm-collab/db/prisma";
import { clearImageAi, getStoredImageAi, openText, saveImageAi, sealText } from "../shared/secure-config";

/**
 * AI 生图配置按企业隔离：scope = 企业 id（存 enterprise_settings，密文），"" = 系统级（只给不属于任何企业的项目用）。
 * 企业没配就不能用，不会借用别的企业或系统级的 Key。每张图按配置的单价记一条用量，用于核算费用。
 */
export type ImageConfig = { baseUrl: string; model: string; apiKey: string; size?: string; priceCents: number; updatedAt?: string; updatedBy?: string };
const KEY = "image_ai";

export async function imageConfig(scope: string): Promise<ImageConfig | null> {
  if (!scope) {
    const c = await getStoredImageAi();
    if (!c) return null;
    const price = await prisma.systemSetting.findUnique({ where: { key: "imageAiPriceCents" } });
    return { baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey, size: c.size, priceCents: Number(price?.value || 0), updatedAt: c.updatedAt, updatedBy: c.updatedBy };
  }
  const row = await prisma.enterpriseSetting.findUnique({ where: { enterpriseId_key: { enterpriseId: scope, key: KEY } } });
  const plain = openText(row?.valueEnc);
  if (!plain) return null;
  try {
    const c = JSON.parse(plain) as ImageConfig;
    return c.apiKey && c.baseUrl && c.model ? { ...c, updatedAt: row!.updatedAt.toISOString() } : null;
  } catch {
    return null;
  }
}

export async function saveImageConfig(scope: string, input: { baseUrl: string; model: string; apiKey?: string; size?: string; priceCents: number }, by: { id: string; name: string }) {
  const prev = await imageConfig(scope);
  const apiKey = input.apiKey || prev?.apiKey;
  if (!apiKey) return { error: "请填写 API Key" };
  if (!scope) {
    await saveImageAi({ baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey, size: input.size }, by.name);
    await prisma.systemSetting.upsert({ where: { key: "imageAiPriceCents" }, create: { key: "imageAiPriceCents", value: String(input.priceCents) }, update: { value: String(input.priceCents) } });
    return { ok: true as const };
  }
  const value = sealText(JSON.stringify({ baseUrl: input.baseUrl, model: input.model, apiKey, size: input.size, priceCents: input.priceCents, updatedBy: by.name }));
  await prisma.enterpriseSetting.upsert({ where: { enterpriseId_key: { enterpriseId: scope, key: KEY } }, create: { enterpriseId: scope, key: KEY, valueEnc: value, updatedById: by.id }, update: { valueEnc: value, updatedById: by.id } });
  return { ok: true as const };
}

export async function clearImageConfig(scope: string) {
  if (!scope) return clearImageAi();
  await prisma.enterpriseSetting.deleteMany({ where: { enterpriseId: scope, key: KEY } });
}

/** 本月生图用量：按成员汇总张数和费用（分） */
export async function imageUsage(scope: string, since: Date) {
  const rows = await prisma.aiUsage.groupBy({
    by: ["userId"],
    where: { feature: "image", enterpriseId: scope || null, createdAt: { gte: since } },
    _sum: { images: true, costCents: true },
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  return rows
    .map((r) => ({ userId: r.userId, name: users.find((u) => u.id === r.userId)?.name || "已删除账号", images: r._sum.images || 0, costCents: r._sum.costCents || 0 }))
    .sort((a, b) => b.costCents - a.costCents);
}
