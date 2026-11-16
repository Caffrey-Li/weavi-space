import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";

/**
 * 系统常规设置（Figma 19）：系统名称、标志、默认时区、每周起始日。
 * 存在 system_settings 表（key / value，Prisma 模型 SystemSetting），表结构在 prisma/migrations 里。
 */
import { DEFAULT_SETTINGS, TIMEZONES, type SystemSettings } from "./system-settings-shared";

export { DEFAULT_SETTINGS, TIMEZONES, type SystemSettings };

const KEYS = ["name", "logo", "timezone", "weekStart"] as const;

/** 同一请求内只查一次 */
export const getSystemSettings = cache(async (): Promise<SystemSettings> => {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...KEYS] } }, select: { key: true, value: true } });
    const out: SystemSettings = { ...DEFAULT_SETTINGS };
    for (const r of rows) if ((KEYS as readonly string[]).includes(r.key)) (out as Record<string, string>)[r.key] = r.value;
    if (out.weekStart !== "0") out.weekStart = "1";
    return out;
  } catch (e) {
    // 读设置失败不应拖垮页面：用默认值
    console.error("[system-settings]", e);
    return { ...DEFAULT_SETTINGS };
  }
});

export async function saveSystemSettings(patch: Partial<SystemSettings>) {
  for (const key of KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}
