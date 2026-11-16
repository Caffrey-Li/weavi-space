import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { parseDate } from "../requirement-write";

export async function GET(session: SessionUser, projectId: string) {
  if (!projectId) return result({ error: "缺少项目" }, { status: 400 });
  if (!(await canSeeProject(session, projectId))) return result({ items: [] });
  const items = await prisma.release.findMany({
    where: { projectId, status: { not: "cancelled" } },
    select: { id: true, version: true, title: true, status: true },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  return result({ items });
}

export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const projectId = body.projectId ? String(body.projectId) : "";
  const version = String(body.version || "").trim().replace(/^v/i, "");
  if (!projectId) return result({ error: "请选择项目" }, { status: 400 });
  if (!version) return result({ error: "版本号必填" }, { status: 400 });
  // 看不到的项目和不存在的项目同样按 404 处理，再查功能权限
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project || !(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", projectId))) {
    return result({ error: "无权限管理该项目发版" }, { status: 403 });
  }
  const dup = await prisma.release.findUnique({ where: { projectId_version: { projectId, version } } });
  if (dup) return result({ error: `该项目已存在版本 v${version}` }, { status: 400 });
  const requirementIds = Array.isArray(body.requirementIds) ? body.requirementIds.map(String) : [];
  const valid = requirementIds.length
    ? await prisma.requirement.findMany({ where: { id: { in: requirementIds }, projectId }, select: { id: true } })
    : [];
  const release = await prisma.release.create({
    data: {
      projectId,
      version,
      title: body.title ? String(body.title).trim() || null : null,
      description: body.description ? String(body.description) : null,
      plannedAt: parseDate(body.plannedAt),
      createdById: session.id,
      items: { create: valid.map((r, i) => ({ requirementId: r.id, sortOrder: i })) },
    },
  });
  await prisma.activityLog.create({
    data: { entityType: "release", entityId: release.id, action: "created", actorId: session.id, message: `创建发版 v${version}` },
  });
  return result({ id: release.id });
}
