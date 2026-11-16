import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "../shared/constants";
import { listRoles } from "../shared/roles";
import { ADMIN_ROLE, defaultRoleAllow } from "../shared/roles-shared";

/** 角色权限页：角色 = 功能权限 + 数据范围 */
export async function loadPermissionsPage(session: SessionUser | null) {
  // 角色权限只有系统管理员能改，其他人只读
  const canEdit = session?.globalRole === ADMIN_ROLE;
  const [roles, rows, counts] = await Promise.all([
    listRoles(),
    prisma.rolePermission.findMany({ where: { scope: "role" }, select: { role: true, feature: true, allowed: true } }),
    prisma.user.groupBy({ by: ["globalRole"], _count: { _all: true } }),
  ]);
  return {
    canEdit,
    features: FEATURES.map((f) => ({ key: f.key, label: f.label })),
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      dataScope: r.key === "admin" ? "all" : r.dataScope,
      isSystem: r.isSystem,
      userCount: counts.find((c) => c.globalRole === r.key)?._count._all || 0,
      permissions: Object.fromEntries(
        FEATURES.map((f) => {
          const row = rows.find((p) => p.role === r.key && p.feature === f.key);
          return [f.key, r.key === "admin" ? true : row ? row.allowed : defaultRoleAllow(r.key, f.key)];
        }),
      ),
    })),
  };
}
