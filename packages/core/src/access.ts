import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import { getRole } from "./shared/roles";
import { listOrgs } from "./shared/org";
import { level2OrgId, subtreeIds } from "./shared/org-shared";
import { ADMIN_ROLE, type DataScope } from "./shared/roles-shared";

type Who = { id: string; globalRole: string };

/**
 * 数据隔离分两层，都在这里落到查询条件：
 * 1. 企业：除系统管理员外，所有人只能碰自己所属企业（二级组织）的数据。项目、产品看 enterpriseId，
 *    公共池的需求 / Bug 跟随创建人所在企业。不属于任何企业的账号看不到业务数据（自己建的公共池内容除外）。
 * 2. 角色的数据范围，在企业之内继续收窄：
 *    - enterprise：本企业全部（all 只属于系统管理员，别的角色存量的 all 按这一档算）
 *    - dept：本部门及下级部门成员参与的项目 + 自己参与的项目
 *    - involved：自己是成员的项目
 *    - self：只看自己创建或负责的需求 / Bug；项目列表只列自己参与的项目
 * projectIds、orgIds 为 null 表示不限（只有系统管理员）。
 */
export type Access = {
  userId: string;
  scope: DataScope;
  /** 能看到的项目 */
  projectIds: string[] | null;
  /** 本企业全部项目（含回收站里的），「仅本人」范围也要用它限定企业 */
  tenantIds: string[] | null;
  /** 所属企业 */
  enterpriseId: string | null;
  /** 本企业全部组织 */
  orgIds: string[] | null;
};

const load = cache(async (userId: string, roleKey: string): Promise<Access> => {
  if (roleKey === ADMIN_ROLE) return { userId, scope: "all", projectIds: null, tenantIds: null, enterpriseId: null, orgIds: null };
  const role = await getRole(roleKey);
  const raw = (role?.dataScope || "involved") as DataScope;
  const scope: DataScope = raw === "all" ? "enterprise" : raw;

  const [me, orgs] = await Promise.all([prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }), listOrgs()]);
  const enterpriseId = level2OrgId(orgs, me?.orgId);
  const orgIds = enterpriseId ? subtreeIds(orgs, enterpriseId) : [];
  // 显式带上 deletedAt 条件绕过默认过滤：回收站里的项目也属于本企业，恢复时要用
  const tenantRows = enterpriseId
    ? await prisma.project.findMany({ where: { enterpriseId, OR: [{ deletedAt: null }, { deletedAt: { not: null } }] }, select: { id: true } })
    : [];
  const tenantIds = tenantRows.map((p) => p.id);
  const tenant = new Set(tenantIds);
  const base = { userId, scope, tenantIds, enterpriseId, orgIds };
  if (scope === "enterprise") return { ...base, projectIds: tenantIds };

  const mine = await prisma.projectMember.findMany({ where: { userId }, select: { projectId: true } });
  const ids = new Set(mine.map((m) => m.projectId).filter((id) => tenant.has(id)));
  if (scope === "dept" && me?.orgId) {
    const deptIds = subtreeIds(orgs, me.orgId);
    const rows = await prisma.projectMember.findMany({ where: { user: { orgId: { in: deptIds } } }, select: { projectId: true } });
    for (const r of rows) if (tenant.has(r.projectId)) ids.add(r.projectId);
  }
  // 产品资料空间（隐藏的 status=space 项目）：产品在数据范围内就能看到对应空间
  const memberIds = Array.from(ids);
  const spaces = await prisma.project.findMany({
    where: {
      status: "space",
      id: { in: tenantIds },
      ...(scope === "dept"
        ? {}
        : {
            product: {
              OR: [
                { ownerId: userId },
                { nodes: { some: { ownerId: userId } } },
                ...(memberIds.length ? [{ projects: { some: { id: { in: memberIds } } } }] : []),
              ],
            },
          }),
    },
    select: { id: true },
  });
  for (const sp of spaces) ids.add(sp.id);
  return { ...base, projectIds: Array.from(ids) };
});

export function getAccess(user: Who): Promise<Access> {
  return load(user.id, user.globalRole);
}

/** 项目是否在数据范围内 */
export async function canSeeProject(user: Who, projectId: string): Promise<boolean> {
  const a = await getAccess(user);
  return a.projectIds === null || a.projectIds.includes(projectId);
}

/** Project 查询条件 */
export function projectWhere(a: Access) {
  return a.projectIds === null ? {} : { id: { in: a.projectIds } };
}

/** 带 projectId 字段的数据（发版、文档页…）的查询条件 */
export function inProjectsWhere(a: Access) {
  return a.projectIds === null ? {} : { projectId: { in: a.projectIds } };
}

/** 公共池（没有项目）的需求 / Bug：跟随创建人所在企业；自己建的始终看得到 */
function poolWhere(a: Access) {
  return { projectId: null, OR: [{ creatorId: a.userId }, { creator: { orgId: { in: a.orgIds || [] } } }] };
}

/** 本企业的需求 / Bug（不看角色范围） */
function tenantWhere(a: Access) {
  return { OR: [{ projectId: { in: a.tenantIds || [] } }, poolWhere(a)] };
}

/** Requirement 查询条件 */
export function requirementWhere(a: Access) {
  if (a.projectIds === null) return {};
  if (a.scope === "self") return { AND: [tenantWhere(a), { OR: [{ creatorId: a.userId }, { assignees: { some: { userId: a.userId } } }] }] };
  return { OR: [{ projectId: { in: a.projectIds } }, poolWhere(a)] };
}

/** 「我负责的 Bug」：处理人、前端负责人、后端负责人任一是我 */
export function myBugOr(userId: string) {
  return [{ assigneeId: userId }, { frontendId: userId }, { backendId: userId }];
}

/** Bug 查询条件 */
export function bugWhere(a: Access) {
  if (a.projectIds === null) return {};
  if (a.scope === "self") return { AND: [tenantWhere(a), { OR: [{ creatorId: a.userId }, ...myBugOr(a.userId)] }] };
  return { OR: [{ projectId: { in: a.projectIds } }, poolWhere(a)] };
}

/** Product 查询条件：本企业 / 本部门 = 本企业全部产品；参与 / 本人 = 本企业内自己负责的产品、负责其中功能的产品、参与项目所属的产品 */
export function productWhere(a: Access) {
  if (a.projectIds === null) return {};
  const enterprise = { enterpriseId: a.enterpriseId ?? "__none__" };
  if (a.scope === "enterprise" || a.scope === "dept") return enterprise;
  return {
    ...enterprise,
    OR: [
      { ownerId: a.userId },
      { nodes: { some: { ownerId: a.userId } } },
      ...(a.projectIds.length ? [{ projects: { some: { id: { in: a.projectIds } } } }] : []),
    ],
  };
}

/** 账号查询条件（人员选择、成员列表）：本企业的人和自己 */
export function userWhere(a: Access) {
  if (a.orgIds === null) return {};
  return { OR: [{ orgId: { in: a.orgIds } }, { id: a.userId }] };
}

/** 公共池内容的创建人是否在本企业 */
async function poolVisible(a: Access, creatorId: string) {
  if (creatorId === a.userId) return true;
  const c = await prisma.user.findUnique({ where: { id: creatorId }, select: { orgId: true } });
  return Boolean(c?.orgId && a.orgIds?.includes(c.orgId));
}

/** 单条需求是否可见 */
export async function canSeeRequirement(user: Who, r: { projectId: string | null; creatorId: string; assigneeIds: string[] }) {
  const a = await getAccess(user);
  if (a.projectIds === null) return true;
  if (!(r.projectId ? a.tenantIds?.includes(r.projectId) : await poolVisible(a, r.creatorId))) return false;
  if (a.scope === "self") return r.creatorId === a.userId || r.assigneeIds.includes(a.userId);
  return !r.projectId || a.projectIds.includes(r.projectId);
}

/** 单个 Bug 是否可见 */
export async function canSeeBug(user: Who, b: { projectId: string | null; creatorId: string; assigneeId: string | null; frontendId?: string | null; backendId?: string | null }) {
  const a = await getAccess(user);
  if (a.projectIds === null) return true;
  if (!(b.projectId ? a.tenantIds?.includes(b.projectId) : await poolVisible(a, b.creatorId))) return false;
  if (a.scope === "self") return b.creatorId === a.userId || [b.assigneeId, b.frontendId, b.backendId].includes(a.userId);
  return !b.projectId || a.projectIds.includes(b.projectId);
}

/** 按 id 判断需求 / Bug / 产品是否在数据范围内（回收站里的算不可见）。写接口和子资源接口用，查不到按 404 处理 */
export async function requirementVisible(user: Who, id: string) {
  return (await prisma.requirement.count({ where: { id, AND: [requirementWhere(await getAccess(user))] } })) > 0;
}
export async function bugVisible(user: Who, id: string) {
  return (await prisma.bug.count({ where: { id, AND: [bugWhere(await getAccess(user))] } })) > 0;
}
export async function productVisible(user: Who, id: string) {
  return (await prisma.product.count({ where: { id, AND: [productWhere(await getAccess(user))] } })) > 0;
}
