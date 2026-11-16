import type { SessionUser } from "../auth";
import { memberCandidateWhere } from "../shared/enterprise";
import { listPositions } from "../shared/roles";
import { listOrgs } from "../shared/org";
import { SYSTEM_ORG_ID } from "../shared/org-shared";
import { prisma } from "@pm-collab/db/prisma";
import { canMany } from "../permissions";
import { REQ_ACTIVE_STATUSES } from "../shared/constants";

/** 项目成员页数据；调用方先 requireProjectPage，项目不存在时返回 null（页面 notFound） */
export async function loadProjectMembersPage(session: SessionUser | null, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { include: { user: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!project) return null;
  const [users, perms, assignments] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, ...(await memberCandidateWhere(project.enterpriseId)) }, orderBy: { name: "asc" } }),
    canMany(session, ["members.manage"] as const, project.id),
    prisma.requirementAssignee.groupBy({
      by: ["userId"],
      where: {
        requirement: { projectId: project.id, archivedAt: null, status: { in: [...REQ_ACTIVE_STATUSES] } },
      },
      _count: true,
    }),
  ]);
  const openByUser = new Map(assignments.map((a) => [a.userId, a._count]));
  // 人员既在项目里，也在组织里：成员表显示所属组织，添加成员时可按组织筛选
  const orgs = await listOrgs();

  return {
    projectId: project.id,
    projectName: project.name,
    canManage: perms["members.manage"],
    members: project.members.map((m) => ({
      id: m.id,
      role: m.role,
      openAssignments: openByUser.get(m.userId) || 0,
      user: {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        globalRole: m.user.globalRole,
        position: m.user.position,
        orgId: m.user.orgId || SYSTEM_ORG_ID,
      },
    })),
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, globalRole: u.globalRole, position: u.position, orgId: u.orgId || SYSTEM_ORG_ID })),
    orgs,
    positions: (await listPositions()).map((p) => ({ key: p.key, name: p.name })),
  };
}
