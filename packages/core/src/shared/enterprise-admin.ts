import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "./roles-shared";
import { SYSTEM_ORG_ID, level2OrgId, listOrgs } from "./org";

/**
 * 企业超级管理员（Organization.adminUserId）：每个企业唯一，只有 Weavi Space 系统超管能指定或更换。
 * - 企业超管可以管理本企业里除自己以外的所有账号（含其他管理者），可以授予除系统管理员以外的角色；
 * - 其他管理者动不了企业超管的账号；
 * - 企业超管本人的角色、所属组织、启停用、删除只能由系统超管在「Weavi Space 后台」处理（先换超管再改）。
 */

/** 企业编码：小写字母开头，小写字母、数字、短横线，2～32 位 */
export const ENTERPRISE_CODE_RE = /^[a-z][a-z0-9-]{1,31}$/;

export function normalizeEnterpriseCode(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** 这个人担任企业超管的企业 id；不是企业超管返回 null */
export async function enterpriseAdminOf(userId: string): Promise<string | null> {
  if (!userId) return null;
  const org = await prisma.organization.findFirst({ where: { adminUserId: userId, type: "enterprise" }, select: { id: true } });
  return org?.id ?? null;
}

/**
 * 操作者对目标账号的特殊规则：
 * - "deny"：目标是企业超管，操作者不是系统超管（含企业超管改自己）；
 * - "allow"：操作者是目标所在企业的企业超管，目标不是自己也不是系统管理员；
 * - "default"：按原来的角色级别 + 管理范围判断（canManageUser）。
 */
export async function enterpriseAuthority(
  actor: { id: string; globalRole: string },
  target: { id: string; globalRole: string; orgId: string | null },
): Promise<"deny" | "allow" | "default"> {
  if (actor.globalRole === ADMIN_ROLE) return "default";
  if (await enterpriseAdminOf(target.id)) return "deny";
  const mine = await enterpriseAdminOf(actor.id);
  if (!mine || target.id === actor.id || target.globalRole === ADMIN_ROLE) return "default";
  const orgs = await listOrgs();
  return level2OrgId(orgs, target.orgId || SYSTEM_ORG_ID) === mine ? "allow" : "default";
}

/** 所有企业超管的账号 id（成员页标记、锁定用） */
export async function enterpriseAdminIds(): Promise<string[]> {
  const rows = await prisma.organization.findMany({ where: { type: "enterprise", adminUserId: { not: null } }, select: { adminUserId: true } });
  return rows.map((r) => r.adminUserId!).filter(Boolean);
}
