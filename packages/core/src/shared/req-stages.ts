import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import { REQ_STAGES_SETTING_KEY, parseHiddenStatuses } from "./req-stages-shared";

/** 停用的需求阶段（存在 system_settings 里；读失败按全部启用） */
export const getHiddenStatuses = cache(async (): Promise<string[]> => {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: REQ_STAGES_SETTING_KEY }, select: { value: true } });
    return parseHiddenStatuses(row?.value || "[]");
  } catch (e) {
    console.error("[需求阶段] 读取失败", e);
    return [];
  }
});

export async function saveHiddenStatuses(hidden: string[]) {
  const value = JSON.stringify(parseHiddenStatuses(hidden));
  await prisma.systemSetting.upsert({ where: { key: REQ_STAGES_SETTING_KEY }, update: { value }, create: { key: REQ_STAGES_SETTING_KEY, value } });
}
