import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { memberCandidateWhere } from "../shared/enterprise";
import { validPosition } from "../shared/roles";
import { NO_POSITION } from "../shared/roles-shared";

export async function GET(session: SessionUser, params: { id: string }) {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project || !(await canSeeProject(session, project.id))) return result({ error: "项目不存在" }, { status: 404 });

  const members = await prisma.projectMember.findMany({
    where: { projectId: params.id },
    include: {
      user: {
        select: { id: true, name: true, email: true, globalRole: true, position: true, isActive: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return result({
    members: members
      .filter((m) => m.user.isActive)
      .map((m) => ({
        id: m.id,
        role: m.role,
        /** 项目内岗位 */
        jobRole: m.role,
        user: {
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          globalRole: m.user.globalRole,
          position: m.user.position,
          avatarUrl: m.user.avatarUrl,
        },
      })),
  });
}

/**
 * 写接口：功能权限检查必须在解析请求体之前（由 getBody 延迟触发）。
 * 适配器传入 () => req.json().catch(() => ({}))，以保留原路由顺序。
 */
export async function POST(
  session: SessionUser,
  params: { id: string },
  getBody: () => Promise<Record<string, unknown>>,
) {
  if (!(await can(session, "members.manage", params.id))) {
    return result({ error: "无权限管理项目成员" }, { status: 403 });
  }
  const body = await getBody();
  // 支持一次按岗位勾选多人：{ userIds: [...] }；兼容旧的 { userId }
  const ids: string[] = Array.isArray(body.userIds)
    ? body.userIds.map(String).filter(Boolean)
    : body.userId
      ? [String(body.userId)]
      : [];
  if (!ids.length) return result({ error: "请选择人员" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, enterpriseId: true } });
  if (!project) return result({ error: "项目不存在" }, { status: 404 });

  // 只能加本企业的人，别的企业的 id 按不存在跳过
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true, ...(await memberCandidateWhere(project.enterpriseId)) },
    select: { id: true, position: true },
  });
  const existing = await prisma.projectMember.findMany({
    where: { projectId: params.id, userId: { in: ids } },
    select: { userId: true },
  });
  const already = new Set(existing.map((m) => m.userId));
  const toAdd = users.filter((u) => !already.has(u.id));

  // 项目内岗位：请求里指定了就用它，否则带出人员的默认岗位
  const asked = typeof body.role === "string" && body.role && body.role !== NO_POSITION ? body.role : "";
  if (asked && !(await validPosition(asked))) return result({ error: "岗位不存在" }, { status: 400 });
  for (const u of toAdd) {
    await prisma.projectMember.create({ data: { projectId: params.id, userId: u.id, role: asked || u.position || NO_POSITION } });
  }
  if (toAdd.length) {
    await prisma.activityLog.create({
      data: {
        entityType: "project",
        entityId: params.id,
        action: "members_added",
        actorId: session.id,
        message: `添加 ${toAdd.length} 名成员`,
      },
    });
  }
  return result({
    added: toAdd.length,
    skipped: ids.length - toAdd.length,
  });
}

/** 调整项目内岗位：{ memberId, role }（role 为岗位 key，member 表示未设置）。不影响权限。 */
export async function PATCH(
  session: SessionUser,
  params: { id: string },
  getBody: () => Promise<Record<string, unknown>>,
) {
  if (!(await can(session, "members.manage", params.id))) {
    return result({ error: "无权限管理项目成员" }, { status: 403 });
  }
  const body = await getBody();
  const member = await prisma.projectMember.findUnique({ where: { id: String(body.memberId || "") } });
  if (!member || member.projectId !== params.id) return result({ error: "该成员不在本项目中" }, { status: 404 });
  const role = String(body.role || NO_POSITION);
  if (role !== NO_POSITION && !(await validPosition(role))) return result({ error: "岗位不存在" }, { status: 400 });
  await prisma.projectMember.update({ where: { id: member.id }, data: { role } });
  await prisma.activityLog.create({
    data: { entityType: "project", entityId: params.id, action: "member_position", actorId: session.id, fromValue: member.role, toValue: role, message: member.userId },
  });
  return result({ ok: true });
}

export async function DELETE(
  session: SessionUser,
  params: { id: string },
  getBody: () => Promise<Record<string, unknown>>,
) {
  if (!(await can(session, "members.manage", params.id))) {
    return result({ error: "无权限管理项目成员" }, { status: 403 });
  }
  const body = await getBody();
  const member = await prisma.projectMember.findUnique({ where: { id: String(body.memberId || "") } });
  if (!member || member.projectId !== params.id) {
    return result({ error: "该成员不在本项目中" }, { status: 404 });
  }
  await prisma.projectMember.delete({ where: { id: member.id } });
  return result({ ok: true });
}
