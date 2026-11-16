import type { SessionUser } from "../auth";
import { roleLabels } from "../shared/roles";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { userScope } from "../shared/admin-gate";
import { SYSTEM_ORG_ID, listOrgs, visibleOrgs } from "../shared/org";

/** 组织架构页：可见组织树 + 成员（非系统管理员只看本企业） */
export async function loadOrgsPage(session: SessionUser | null) {
  const [allOrgs, allUsers, canManage] = await Promise.all([
    listOrgs(),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, globalRole: true, avatarUrl: true, orgId: true },
      orderBy: { name: "asc" },
    }),
    session ? can(session, "users.manage") : Promise.resolve(false),
  ]);
  // 非系统管理员只看本企业的组织和人（以及自己）
  const scope = session ? await userScope(session) : new Set<string>();
  const orgs = visibleOrgs(allOrgs, scope);
  const users = scope ? allUsers.filter((u) => (u.orgId && scope.has(u.orgId)) || u.id === session?.id) : allUsers;
  const ids = new Set(orgs.map((o) => o.id));
  const roleNames = await roleLabels();
  // 没有所属组织（或指向已删组织）的账号算在系统组织下
  const members = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: roleNames[u.globalRole] || u.globalRole,
    orgId: u.orgId && ids.has(u.orgId) ? u.orgId : SYSTEM_ORG_ID,
  }));
  return {
    orgs,
    members,
    canManage,
    isAdmin: session?.globalRole === "admin",
  };
}
