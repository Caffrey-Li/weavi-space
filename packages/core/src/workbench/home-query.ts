import type { SessionUser } from "../auth";
import { endOfWeek, startOfWeek } from "date-fns";
import { prisma } from "@pm-collab/db/prisma";
import { canMany } from "../permissions";
import { REQ_ACTIVE_STATUSES } from "../shared/constants";
import { getAccess, projectWhere as scopeProjects, requirementWhere, bugWhere } from "../access";

export async function loadWorkbenchData(user: SessionUser, now: Date) {
  const access = await getAccess(user);
  const projectWhere = { status: "active", ...scopeProjects(access) };
  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const projectIds = projects.length ? projects.map((p) => p.id) : ["__none__"];
  const scope = { archivedAt: null, projectId: { in: projectIds } };

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const [myReqs, myBugs, perms, logs] = await Promise.all([
    prisma.requirement.findMany({
      where: { status: { in: [...REQ_ACTIVE_STATUSES] }, assignees: { some: { userId: user.id } }, archivedAt: null, AND: [requirementWhere(access)] },
      include: { project: true, assignees: { include: { user: true } } },
      orderBy: [{ plannedEndAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.bug.findMany({
      where: { OR: [{ assigneeId: user.id }, { frontendId: user.id }, { backendId: user.id }], archivedAt: null, AND: [bugWhere(access)], status: { notIn: ["closed", "cancelled"] } },
      select: { id: true, severity: true },
    }),
    canMany(user, ["board.move"] as const),
    prisma.activityLog.findMany({
      where: { entityType: { in: ["requirement", "bug", "release"] } },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  // 最近动态：只显示我能看到的项目里的需求 / Bug / 发版
  const idsOf = (t: string) => Array.from(new Set(logs.filter((l) => l.entityType === t).map((l) => l.entityId)));
  const [logReqs, logBugs, logRels] = await Promise.all([
    prisma.requirement.findMany({ where: { id: { in: idsOf("requirement") }, ...scope }, select: { id: true, title: true, project: { select: { key: true } } } }),
    prisma.bug.findMany({ where: { id: { in: idsOf("bug") }, projectId: { in: projectIds } }, select: { id: true, title: true, projectId: true } }),
    prisma.release.findMany({ where: { id: { in: idsOf("release") }, projectId: { in: projectIds } }, select: { id: true, version: true, project: { select: { key: true } } } }),
  ]);
  const entityOf = new Map<string, { label: string; href: string }>();
  for (const r of logReqs)
    entityOf.set(r.id, { label: `${r.project ? `${r.project.key}-${r.id.slice(-4).toUpperCase()} ` : ""}${r.title}`, href: `/requirements/${r.id}` });
  for (const b of logBugs) entityOf.set(b.id, { label: b.title, href: `/projects/${b.projectId}/bugs` });
  for (const r of logRels) entityOf.set(r.id, { label: `${r.project.key} v${r.version}`, href: `/releases/${r.id}` });
  const recent = logs.filter((l) => entityOf.has(l.entityId)).slice(0, 6);

  return { myReqs, myBugs, perms, entityOf, recent, weekStart, weekEnd };
}
