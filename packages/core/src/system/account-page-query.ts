import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { positionLabels, roleLabels } from "../shared/roles";

/** 设置 · 账号页数据 */
export async function loadAccountPage(user: SessionUser) {
  const [me, roleNames, posNames] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { position: true, passwordHash: true } }),
    roleLabels(),
    positionLabels(),
  ]);
  const projects = await prisma.projectMember.findMany({
    where: { userId: user.id },
    include: { project: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    force: Boolean(user.mustChangePassword),
    /** 还没有密码（接受邀请或被重置后）：设置密码时不需要当前密码 */
    hasPassword: Boolean(me?.passwordHash),
    profile: {
      name: user.name,
      avatarUrl: user.avatarUrl,
      account: user.email,
      jobRole: me?.position ? posNames[me.position] || me.position : "未设置岗位",
      globalRole: roleNames[user.globalRole] || user.globalRole,
    },
    posNames,
    projects: projects.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      role: m.role,
      project: { name: m.project.name, iconUrl: m.project.iconUrl },
    })),
  };
}
