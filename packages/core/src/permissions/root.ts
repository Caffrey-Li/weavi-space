import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "../shared/constants";
import { listRoles } from "../shared/roles";

/** 角色功能权限（scope=role）。完整的角色配置见 /api/roles */
export async function GET(_session: SessionUser) {
  void _session;
  const [roles, rows] = await Promise.all([listRoles(), prisma.rolePermission.findMany({ where: { scope: "role" } })]);
  return result({ features: FEATURES, roles: roles.map((r) => r.key), permissions: rows });
}

/** 单项开关：{ role, feature, allowed } */
export async function PATCH(_session: SessionUser, body: Record<string, unknown>) {
  void _session;
  const role = String(body.role || "");
  const feature = String(body.feature || "");
  if (!role || !feature) return result({ error: "role / feature 必填" }, { status: 400 });
  if (role === "admin") return result({ error: "系统管理员固定拥有全部权限" }, { status: 400 });
  if (!(await listRoles()).some((r) => r.key === role)) return result({ error: "角色不存在" }, { status: 400 });
  if (!FEATURES.some((f) => f.key === feature)) return result({ error: "非法功能" }, { status: 400 });
  const row = await prisma.rolePermission.upsert({
    where: { scope_role_feature: { scope: "role", role, feature } },
    create: { scope: "role", role, feature, allowed: Boolean(body.allowed) },
    update: { allowed: Boolean(body.allowed) },
  });
  return result({ permission: row });
}
