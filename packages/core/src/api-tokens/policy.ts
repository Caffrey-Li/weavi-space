import { prisma } from "@pm-collab/db/prisma";
import { openText, sealText } from "../shared/secure-config";
import { SYSTEM_ORG_ID, level2OrgId, listOrgs } from "../shared/org";
import { API_SCOPES, isApiScope, type ApiScope } from "./scopes";

/**
 * T34 企业的数据开放策略（MCP 和开放接口 v1 共用个人 API 令牌）：
 * - allowTokens：是否允许本企业成员创建令牌、使用已有令牌；
 * - scopes：令牌最多能拿到的范围。创建时超出的不能签发；已有令牌按交集生效（管理员收紧后立即生效，放宽后不会自动变大）。
 * 存在 enterprise_settings（key = api_policy，密文 JSON）；不属于企业的账号用 enterpriseId = ""，由系统超管管理。
 * 没配置过 = 允许、全部范围（与 T34 之前一致）。
 */
export type ApiPolicy = { allowTokens: boolean; scopes: ApiScope[] };
export const DEFAULT_POLICY: ApiPolicy = { allowTokens: true, scopes: [...API_SCOPES] };
const KEY = "api_policy";
const TTL = 30_000;
const cache = new Map<string, { at: number; policy: ApiPolicy }>();

export function parsePolicy(raw: string | null | undefined): ApiPolicy {
  if (!raw) return { ...DEFAULT_POLICY, scopes: [...DEFAULT_POLICY.scopes] };
  try {
    const v = JSON.parse(raw) as { allowTokens?: unknown; scopes?: unknown };
    const scopes = Array.isArray(v.scopes) ? Array.from(new Set(v.scopes.map(String).filter(isApiScope))) : [...API_SCOPES];
    return { allowTokens: v.allowTokens !== false, scopes };
  } catch {
    // 读不出来时按最严处理，不放开
    return { allowTokens: false, scopes: [] };
  }
}

/** 账号所属企业 id（不属于企业 = ""） */
export async function enterpriseOfOrg(orgId: string | null | undefined) {
  const orgs = await listOrgs();
  return level2OrgId(orgs, orgId || SYSTEM_ORG_ID) || "";
}

export async function readPolicy(enterpriseId: string, fresh = false): Promise<ApiPolicy> {
  const hit = cache.get(enterpriseId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.policy;
  const row = await prisma.enterpriseSetting.findUnique({ where: { enterpriseId_key: { enterpriseId, key: KEY } } });
  const policy = parsePolicy(row ? openText(row.valueEnc) : null);
  cache.set(enterpriseId, { at: Date.now(), policy });
  return policy;
}

export async function savePolicy(enterpriseId: string, policy: ApiPolicy, actorId: string) {
  const clean: ApiPolicy = { allowTokens: Boolean(policy.allowTokens), scopes: Array.from(new Set(policy.scopes.filter(isApiScope))) };
  const valueEnc = sealText(JSON.stringify(clean));
  await prisma.enterpriseSetting.upsert({
    where: { enterpriseId_key: { enterpriseId, key: KEY } },
    create: { enterpriseId, key: KEY, valueEnc, updatedById: actorId },
    update: { valueEnc, updatedById: actorId },
  });
  cache.set(enterpriseId, { at: Date.now(), policy: clean });
  return clean;
}

/** 令牌实际生效的范围：令牌自己的范围 ∩ 企业允许的范围；企业关闭令牌时为空 */
export function effectiveScopes(tokenScopes: readonly string[], policy: ApiPolicy): ApiScope[] {
  if (!policy.allowTokens) return [];
  return tokenScopes.filter((s): s is ApiScope => isApiScope(s) && policy.scopes.includes(s));
}

/** 测试用：清掉进程内缓存 */
export function clearPolicyCache() {
  cache.clear();
}

/** 这个账号所在企业的策略（个人能力页、本机 Agent 页用来只显示允许的范围） */
export async function policyForUser(userId: string): Promise<ApiPolicy> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  return readPolicy(await enterpriseOfOrg(u?.orgId), true);
}

/** 可以勾选的范围（按 API_SCOPES 的顺序）；企业关闭令牌时为空 */
export function allowedScopes(policy: ApiPolicy): ApiScope[] {
  return policy.allowTokens ? API_SCOPES.filter((s) => policy.scopes.includes(s)) : [];
}
