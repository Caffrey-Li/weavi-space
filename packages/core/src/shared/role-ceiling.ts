import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "./constants";
import { openText, sealText } from "./secure-config";
import { SYSTEM_ORG_ID, level2OrgId, listOrgs } from "./org";

/**
 * T37 企业角色的权限上限：系统超管给每个企业定「企业自建角色最多能开哪些功能」。
 * 存 enterprise_settings（key = role_ceiling，JSON 功能点数组）；没设过 = 全部功能（系统管理员专属的设置本来就不在功能点里）。
 * 上限在两处生效：保存企业角色时超出的拒绝；判断权限时（can）再取交集，上限收紧后已有角色立即受限。
 */
const KEY = "role_ceiling";
const ALL = FEATURES.map((f) => f.key as string);

export function parseCeiling(raw: string | null | undefined): string[] {
  if (!raw) return [...ALL];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? ALL.filter((k) => v.includes(k)) : [];
  } catch {
    return [];
  }
}

export const roleCeiling = cache(async (enterpriseId: string): Promise<string[]> => {
  if (!enterpriseId) return [...ALL];
  const row = await prisma.enterpriseSetting.findUnique({ where: { enterpriseId_key: { enterpriseId, key: KEY } } });
  return parseCeiling(row ? openText(row.valueEnc) : null);
});

export async function saveRoleCeiling(enterpriseId: string, features: string[], actorId: string) {
  const clean = ALL.filter((k) => features.includes(k));
  const valueEnc = sealText(JSON.stringify(clean));
  await prisma.enterpriseSetting.upsert({
    where: { enterpriseId_key: { enterpriseId, key: KEY } },
    create: { enterpriseId, key: KEY, valueEnc, updatedById: actorId },
    update: { valueEnc, updatedById: actorId },
  });
  return clean;
}

/** 账号所属企业（同一请求内缓存；不属于企业 = ""） */
export const enterpriseOfUserId = cache(async (userId: string): Promise<string> => {
  if (!userId) return "";
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  return level2OrgId(await listOrgs(), u?.orgId || SYSTEM_ORG_ID) || "";
});
