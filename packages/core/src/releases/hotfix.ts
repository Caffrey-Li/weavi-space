import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { parseDate } from "../requirement-write";
import { dayNoon, hotfixBugCandidates, shanghaiToday, suggestHotfixVersion } from "./schedule";

export async function GET(session: SessionUser, projectId: string) {
  if (!projectId) return result({ error: "缺少项目" }, { status: 400 });
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  const [last, versions, bugs] = await Promise.all([
    prisma.release.findFirst({ where: { projectId, status: "released" }, orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }], select: { version: true } }),
    prisma.release.findMany({ where: { projectId }, select: { version: true } }),
    hotfixBugCandidates(projectId),
  ]);
  return result({
    suggestedVersion: suggestHotfixVersion(last?.version || null, versions.map((v) => v.version)),
    baseVersion: last?.version || null,
    bugs: bugs.map((b) => ({ id: b.id, title: b.title, status: b.status, severity: b.severity, environment: b.environment })),
  });
}

export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const projectId = body.projectId ? String(body.projectId) : "";
  const version = String(body.version || "").trim().replace(/^v/i, "");
  const reason = String(body.reason || "").trim();
  if (!projectId) return result({ error: "请选择项目" }, { status: 400 });
  if (!version) return result({ error: "版本号必填" }, { status: 400 });
  if (version.length > 60) return result({ error: "版本号太长" }, { status: 400 });
  if (!reason) return result({ error: "请说明紧急发版的原因" }, { status: 400 });
  if (reason.length > 2000) return result({ error: "原因说明不超过 2000 字" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, status: true } });
  if (!project || project.status === "space" || !(await canSeeProject(session, projectId))) {
    return result({ error: "项目不存在" }, { status: 400 });
  }
  if (!(await can(session, "releases.manage", projectId))) return result({ error: "无权限管理该项目发版" }, { status: 403 });
  const dup = await prisma.release.findUnique({ where: { projectId_version: { projectId, version } } });
  if (dup) return result({ error: `该项目已存在版本 v${version}` }, { status: 400 });
  const ids = (k: string) => (Array.isArray(body[k]) ? (body[k] as unknown[]).map(String).slice(0, 200) : []);
  const [reqs, bugs] = await Promise.all([
    ids("requirementIds").length
      ? prisma.requirement.findMany({ where: { id: { in: ids("requirementIds") }, projectId }, select: { id: true } })
      : [],
    ids("bugIds").length ? prisma.bug.findMany({ where: { id: { in: ids("bugIds") }, projectId }, select: { id: true } }) : [],
  ]);
  const startNow = body.startNow === true;
  const release = await prisma.release.create({
    data: {
      projectId,
      version,
      title: body.title ? String(body.title).trim().slice(0, 120) || null : null,
      description: body.description ? String(body.description).slice(0, 4000) : null,
      reason,
      kind: "hotfix",
      status: startNow ? "releasing" : "planning",
      plannedAt: parseDate(body.plannedAt) || dayNoon(shanghaiToday()),
      createdById: session.id,
      items: { create: reqs.map((r, i) => ({ requirementId: r.id, sortOrder: i })) },
      bugs: { create: bugs.map((b) => ({ bugId: b.id })) },
    },
  });
  await prisma.activityLog.create({
    data: {
      entityType: "release",
      entityId: release.id,
      action: "created",
      actorId: session.id,
      message: `创建紧急发版 v${version}${startNow ? "，直接开始发布" : ""}${bugs.length ? `，修复 ${bugs.length} 个 Bug` : ""}`,
    },
  });
  for (const b of bugs) {
    await prisma.activityLog.create({
      data: { entityType: "bug", entityId: b.id, action: "release_linked", actorId: session.id, message: `加入紧急发版 v${version}` },
    });
  }
  return result({ id: release.id });
}
