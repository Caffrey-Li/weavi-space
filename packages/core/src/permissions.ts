import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "./auth";
import { canSeeProject } from "./access";
import { defaultRoleAllow } from "./shared/roles-shared";
import { isReadScope } from "./api-tokens/scopes";

type Who = SessionUser | { id: string; globalRole: string; apiTokenScopes?: readonly string[] };

/** 角色的功能权限（scope=role），同一请求内只查一次 */
const roleFeatures = cache(async (role: string) => {
  const rows = await prisma.rolePermission.findMany({ where: { scope: "role", role }, select: { feature: true, allowed: true } });
  return new Map(rows.map((r) => [r.feature, r.allowed]));
});

/**
 * 功能权限只看角色（User.globalRole），岗位不参与。
 * 带 projectId 时还要求该项目在角色的数据范围内。系统管理员始终放行。
 */
export async function can(user: Who, feature: string, projectId?: string | null): Promise<boolean> {
  // 令牌的 scope 在管理员特权之前生效；缺省字段仍保持 Cookie 的原有行为。
  if (user.apiTokenScopes) {
    if (!user.apiTokenScopes.includes(feature)) return false;
  }
  if (user.globalRole === "admin") return true;
  if (projectId && !(await canSeeProject(user, projectId))) return false;
  // 读取 scope 不在功能权限矩阵中，但指定项目时仍需通过项目范围检查。
  if (user.apiTokenScopes && isReadScope(feature)) return true;
  const set = (await roleFeatures(user.globalRole)).get(feature);
  return set ?? defaultRoleAllow(user.globalRole, feature);
}

/** @deprecated 旧名，等同 defaultRoleAllow */
export function fallbackAllow(role: string, feature: string): boolean {
  return defaultRoleAllow(role, feature);
}

export async function requireCan(user: SessionUser, feature: string, projectId?: string | null): Promise<boolean> {
  return can(user, feature, projectId);
}

/** 页面一次性取多个功能点的可见性（仅用于决定是否展示入口，服务端接口仍各自校验）。 */
export async function canMany<F extends string>(
  user: Who | null,
  features: readonly F[],
  projectId?: string | null,
): Promise<Record<F, boolean>> {
  const out = {} as Record<F, boolean>;
  for (const f of features) out[f] = user ? await can(user, f, projectId) : false;
  return out;
}
