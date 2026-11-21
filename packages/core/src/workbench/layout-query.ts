import type { SessionUser } from "../auth";
import { visibleRoles } from "../roles/root";
import { clientFlows } from "../flow/service";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { REQ_ACTIVE_STATUSES } from "../shared/constants";
import { loadProductNav } from "../products/nav-query";
import { getSystemSettings } from "../shared/system-settings";
import { bugWhere, getAccess, projectWhere, requirementWhere } from "../access";
import { listPositions } from "../shared/roles";

export async function loadAppLayoutData(user: SessionUser) {
  const access = await getAccess(user);
  const [allRequirements, myRequirements, myBugs, projects, canCreate, canCreateBug, canManageProducts] = await Promise.all([
    prisma.requirement.count({ where: { archivedAt: null, ...requirementWhere(access) } }),
    prisma.requirement.count({
      where: { archivedAt: null, status: { in: [...REQ_ACTIVE_STATUSES] }, assignees: { some: { userId: user.id } }, AND: [requirementWhere(access)] },
    }),
    prisma.bug.count({ where: { archivedAt: null, OR: [{ assigneeId: user.id }, { frontendId: user.id }, { backendId: user.id }], status: { notIn: ["closed", "cancelled"] }, AND: [bugWhere(access)] } }),
    // 「项目」范围的项目列表：角色数据范围内的进行中项目
    prisma.project.findMany({
      where: { status: "active", ...projectWhere(access) },
      select: { id: true, name: true, iconUrl: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    can(user, "requirements.create"),
    can(user, "bugs.edit"),
    can(user, "products.manage"),
  ]);
  // 「产品」侧栏的数据直接由服务端给出（视图计数、产品列表、当前产品的切换卡），不用等浏览器请求
  const [productNav, system, roles, positions, flows] = await Promise.all([loadProductNav(user), getSystemSettings(), visibleRoles(user), listPositions(), clientFlows(user)]);
  return { allRequirements, myRequirements, myBugs, projects, canCreate, canCreateBug, canManageProducts, productNav, system, roles, positions, hiddenStatuses: flows.base.hidden, flows };
}
