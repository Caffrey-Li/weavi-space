import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { FEATURES } from "../shared/constants";
import { listPositions } from "../shared/roles";
import { visibleRoles } from "../roles/root";
import { defaultRoleAllow } from "../shared/roles-shared";
import { canAssignRole, userScope } from "../shared/admin-gate";
import { ADMIN_ROLE, outranks } from "../shared/roles-shared";
import { enterpriseAdminIds, enterpriseAdminOf } from "../shared/enterprise-admin";
import { SYSTEM_ORG_ID, listOrgs, visibleOrgs } from "../shared/org";
import { maskPhone, openPhone } from "../login/phone";

/** 成员管理页（所属组织、角色、岗位） */
export async function loadMembersPage(
  session: SessionUser | null,
  searchParams: { new?: string; org?: string },
) {
  const canManageUsers = session ? await can(session, "users.manage") : false;

  // 非系统管理员只看得到本企业的组织和人（以及自己）
  const scope = session ? await userScope(session) : new Set<string>();
  const [allOrgs, users, roles, positions, perms] = await Promise.all([
    listOrgs(),
    prisma.user.findMany({
      where: scope ? { OR: [{ orgId: { in: Array.from(scope) } }, { id: session?.id }] } : {},
      include: { projectMembers: { include: { project: true } }, sessions: { take: 1, select: { id: true } } },
      orderBy: { name: "asc" },
    }),
    session ? visibleRoles(session) : Promise.resolve([]),
    listPositions(),
    prisma.rolePermission.findMany({ where: { scope: "role" }, select: { role: true, feature: true, allowed: true } }),
  ]);
  const featureCount = (role: string) =>
    FEATURES.filter((f) => {
      const row = perms.find((p) => p.role === role && p.feature === f.key);
      return row ? row.allowed : defaultRoleAllow(role, f.key);
    }).length;

  const orgs = visibleOrgs(allOrgs, scope);
  // 前端只隐藏入口，服务端接口按同样的规则校验
  const [entAdmins, myEnterprise] = await Promise.all([enterpriseAdminIds(), session ? enterpriseAdminOf(session.id) : Promise.resolve(null)]);
  const assignableRoles: string[] = [];
  if (session) for (const r of roles) if (await canAssignRole(session, r.key)) assignableRoles.push(r.key);

  return {
    canManage: canManageUsers,
    currentUserId: session?.id ?? "",
    // 企业超管能管理本企业除系统管理员以外的所有角色（含其他管理者）
    manageableRoles: session ? roles.filter((r) => (myEnterprise ? r.key !== ADMIN_ROLE : outranks(session.globalRole, r.key))).map((r) => r.key) : [],
    /** 企业超管的账号：成员页标「企业超管」；非系统超管不能在这里改（含企业超管本人） */
    enterpriseAdminIds: entAdmins,
    lockedUserIds: session?.globalRole === ADMIN_ROLE ? [] : entAdmins,
    assignableRoles,
    orgs,
    selectedOrg: searchParams.org,
    openCreate: searchParams.new === "1",
    roles: roles.map((r) => ({ key: r.key, name: r.name, dataScope: r.key === "admin" ? "all" : r.dataScope, featureCount: featureCount(r.key) })),
    positions: positions.map((p) => ({ key: p.key, name: p.name })),
    featureTotal: FEATURES.length,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      globalRole: u.globalRole,
      position: u.position,
      isActive: u.isActive,
      avatarUrl: u.avatarUrl,
      orgId: u.orgId ?? SYSTEM_ORG_ID,
      /** 手机号脱敏值；没有密码 = 还没接受邀请或刚被重置 */
      phone: maskPhone(openPhone(u.phoneEnc)),
      pending: !u.passwordHash,
      /** 从没登录过的待激活账号（还没用邀请码）：「重新生成邀请码」；登录过、被重置的发重置链接 */
      invited: !u.passwordHash && u.sessions.length === 0,
      projectMembers: u.projectMembers.map((m) => ({
        id: m.id,
        role: m.role,
        project: { id: m.project.id, key: m.project.key, name: m.project.name, iconUrl: m.project.iconUrl },
      })),
    })),
  };
}
