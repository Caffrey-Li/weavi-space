import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "../auth";
import { can } from "../permissions";
import { prisma } from "@pm-collab/db/prisma";
import { listOrgs, managedOrgIds } from "./org";
import { ADMIN_ROLE, outranks } from "./roles-shared";
import { enterpriseAdminOf } from "./enterprise-admin";

/** 组织 / 账号 / 角色 / 岗位配置：需要「账号管理」权限 */
export async function requireUserAdmin(): Promise<{ session: SessionUser; error?: undefined } | { error: NextResponse; session?: undefined }> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (!(await can(session, "users.manage"))) return { error: NextResponse.json({ error: "没有账号管理权限" }, { status: 403 }) };
  return { session };
}

/** 操作者的管理范围（组织 id 集合）；null 表示不限（系统管理员） */
export async function userScope(actor: Pick<SessionUser, "id" | "globalRole">): Promise<Set<string> | null> {
  if (actor.globalRole === ADMIN_ROLE) return null;
  const [me, orgs] = await Promise.all([prisma.user.findUnique({ where: { id: actor.id }, select: { orgId: true } }), listOrgs()]);
  return new Set(managedOrgIds(orgs, me?.orgId));
}

/** 全局配置（角色、权限矩阵、岗位、系统设置）：只有系统管理员（超管） */
export async function requireSystemAdmin(): Promise<{ session: SessionUser; error?: undefined } | { error: NextResponse; session?: undefined }> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (session.globalRole !== ADMIN_ROLE) return { error: NextResponse.json({ error: "只有系统管理员可以修改全局配置" }, { status: 403 }) };
  return { session };
}

/** 能否把别人设为这个角色：级别要比操作者低，非管理员也不能授予带账号管理权限的角色（否则等于提拔成管理者） */
export async function canAssignRole(actor: SessionUser, role: string) {
  if (actor.globalRole === ADMIN_ROLE) return true;
  // 企业超管可以授予除系统管理员以外的任何角色（含管理者）
  if (role !== ADMIN_ROLE && (await enterpriseAdminOf(actor.id))) return true;
  return outranks(actor.globalRole, role) && !(await can({ id: "", globalRole: role }, "users.manage"));
}

/** 生成自定义角色 / 岗位的 key：前缀 + 6 位随机小写字母数字 */
export function randomKey(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
}
