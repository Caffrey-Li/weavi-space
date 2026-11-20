import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import { DEFAULT_POSITIONS, DEFAULT_ROLES, type PositionRow, type RoleRow } from "./roles-shared";

let ensured: Promise<void> | null = null;

/** 角色 / 岗位表缺默认数据时补上（只插不改；库里已有同 key 的不动） */
export function ensureRolesAndPositions(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const [roleKeys, posKeys] = await Promise.all([
        prisma.role.findMany({ select: { key: true } }),
        prisma.position.findMany({ select: { key: true } }),
      ]);
      const hasRole = new Set(roleKeys.map((r) => r.key));
      const hasPos = new Set(posKeys.map((p) => p.key));
      for (const r of DEFAULT_ROLES) if (!hasRole.has(r.key)) await prisma.role.create({ data: r }).catch(() => undefined);
      for (const p of DEFAULT_POSITIONS) if (!hasPos.has(p.key)) await prisma.position.create({ data: p }).catch(() => undefined);
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

const ROLE_SELECT = { id: true, key: true, name: true, description: true, dataScope: true, isSystem: true, sortOrder: true, enterpriseId: true } as const;
const POS_SELECT = { id: true, key: true, name: true, description: true, isSystem: true, sortOrder: true } as const;

/** 全部角色（同一请求内缓存） */
export const listRoles = cache(async (): Promise<RoleRow[]> => {
  await ensureRolesAndPositions();
  return prisma.role.findMany({ select: ROLE_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
});

/** 全部岗位（同一请求内缓存） */
export const listPositions = cache(async (): Promise<PositionRow[]> => {
  await ensureRolesAndPositions();
  return prisma.position.findMany({ select: POS_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
});

export async function getRole(key: string): Promise<RoleRow | null> {
  return (await listRoles()).find((r) => r.key === key) || null;
}

export async function roleLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await listRoles()).map((r) => [r.key, r.name]));
}

export async function positionLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await listPositions()).map((p) => [p.key, p.name]));
}

/** 校验角色 key */
export async function validRole(key: string) {
  return (await listRoles()).some((r) => r.key === key);
}

/** 校验岗位 key；空值表示不设默认岗位 */
export async function validPosition(key: string) {
  return !key || (await listPositions()).some((p) => p.key === key);
}

/** T37：某企业能看到、能用的角色 = 系统角色 + 本企业角色；enterpriseId 为 null 表示不限（系统超管看全部） */
export async function rolesForEnterprise(enterpriseId: string | null) {
  const all = await listRoles();
  return enterpriseId === null ? all : all.filter((r) => !r.enterpriseId || r.enterpriseId === enterpriseId);
}

/** T37：企业角色只能给本企业的人；系统角色谁都能用 */
export async function roleFitsEnterprise(roleKey: string, enterpriseId: string) {
  const r = (await listRoles()).find((x) => x.key === roleKey);
  return Boolean(r) && (!r!.enterpriseId || r!.enterpriseId === enterpriseId);
}
