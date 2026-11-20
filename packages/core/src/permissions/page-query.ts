import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "../shared/constants";
import { ADMIN_ROLE, defaultRoleAllow } from "../shared/roles-shared";
import { roleCeiling } from "../shared/role-ceiling";
import { roleManager, visibleRoles } from "../roles/root";

/**
 * 角色权限页：角色 = 功能权限 + 数据范围。
 * T37：系统超管能改全部角色、给企业定权限上限；企业超管能新建和修改本企业的角色（不超过上限），系统角色只读；其他人只读。
 * 非系统超管只看得到系统角色和本企业的角色。
 */
export async function loadPermissionsPage(session: SessionUser | null) {
  const m = session ? await roleManager(session) : { admin: false, enterpriseId: null };
  const canEdit = m.admin || Boolean(m.enterpriseId);
  const [roles, rows, counts, enterprises] = await Promise.all([
    session ? visibleRoles(session) : Promise.resolve([]),
    prisma.rolePermission.findMany({ where: { scope: "role" }, select: { role: true, feature: true, allowed: true } }),
    prisma.user.groupBy({ by: ["globalRole"], _count: { _all: true } }),
    prisma.organization.findMany({ where: { type: "enterprise" }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const entName = new Map(enterprises.map((e) => [e.id, e.name]));
  const ceilings = new Map<string, string[]>();
  for (const id of new Set(roles.map((r) => r.enterpriseId).filter((x): x is string => Boolean(x)))) ceilings.set(id, await roleCeiling(id));
  return {
    canEdit,
    isSystemAdmin: m.admin,
    /** 新建角色时可选的归属：系统超管 = 系统角色 + 各企业；企业超管 = 本企业 */
    createIn: m.admin ? [{ id: "", name: "系统角色（所有企业通用）" }, ...enterprises] : m.enterpriseId ? [{ id: m.enterpriseId, name: entName.get(m.enterpriseId) || "本企业" }] : [],
    enterprises: m.admin ? enterprises : [],
    features: FEATURES.map((f) => ({ key: f.key, label: f.label })),
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      dataScope: r.key === "admin" ? "all" : r.dataScope,
      isSystem: r.isSystem,
      enterpriseId: r.enterpriseId || "",
      enterpriseName: r.enterpriseId ? entName.get(r.enterpriseId) || "已删除的企业" : null,
      editable: m.admin || (Boolean(m.enterpriseId) && r.enterpriseId === m.enterpriseId),
      ceiling: r.enterpriseId ? ceilings.get(r.enterpriseId) || [] : null,
      userCount: counts.find((c) => c.globalRole === r.key)?._count._all || 0,
      permissions: Object.fromEntries(
        FEATURES.map((f) => {
          const row = rows.find((p) => p.role === r.key && p.feature === f.key);
          return [f.key, r.key === ADMIN_ROLE ? true : row ? row.allowed : defaultRoleAllow(r.key, f.key)];
        }),
      ),
    })),
  };
}
