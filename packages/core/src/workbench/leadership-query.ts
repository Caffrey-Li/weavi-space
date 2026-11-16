import type { SessionUser } from "../auth";
import { subWeeks } from "date-fns";
import { getAccess, projectWhere } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { RELEASE_OPEN_STATUSES } from "../shared/constants";

export async function loadLeadershipData(session: SessionUser | null, selectedProject: string | undefined, dates: { now: Date; from: Date; prevFrom: Date; monthFrom: Date; prevMonthFrom: Date }) {
  const { now, from, prevFrom, monthFrom, prevMonthFrom } = dates;
  const access = session ? await getAccess(session) : null;
  const visible = access ? projectWhere(access) : { id: "__none__" };
  const allProjects = await prisma.project.findMany({ where: { status: { notIn: ["archived", "space"] }, ...visible }, orderBy: { createdAt: "asc" } });
  const projectId = allProjects.some((p) => p.id === selectedProject) ? selectedProject! : "";
  // 数据范围：只统计角色可见的项目
  const scope = projectId
    ? { projectId }
    : access?.projectIds === null
      ? { project: { status: { not: "archived" } } }
      : { projectId: { in: allProjects.length ? allProjects.map((p) => p.id) : ["__none__"] } };

  const [projects, onlineNow, onlinePrev, activeReqs, openBugs, newBugs, relNow, relPrev, overdue, blockers, unassigned, upcoming] =
    await Promise.all([
      prisma.project.findMany({
        where: { status: { notIn: ["archived", "space"] }, ...visible, ...(projectId ? { id: projectId } : {}) },
        include: {
          members: { where: { role: "pm" }, include: { user: true }, take: 1 },
          createdBy: true,
          requirements: { where: { archivedAt: null }, select: { status: true } },
          bugs: { where: { archivedAt: null, status: { notIn: ["closed", "cancelled"] } }, select: { severity: true } },
          releases: {
            where: { status: { in: [...RELEASE_OPEN_STATUSES] } },
            orderBy: [{ plannedAt: "asc" }],
            include: { items: { include: { requirement: { select: { status: true } } } } },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.requirement.count({ where: { ...scope, archivedAt: null, status: "online", actualEndAt: { gte: from } } }),
      prisma.requirement.count({ where: { ...scope, archivedAt: null, status: "online", actualEndAt: { gte: prevFrom, lt: from } } }),
      prisma.requirement.count({ where: { ...scope, archivedAt: null, status: { in: ["dev_todo", "dev_in_progress", "dev_done", "test_todo", "test_in_progress", "test_done"] } } }),
      prisma.bug.count({ where: { ...scope, archivedAt: null, status: { notIn: ["closed", "cancelled"] } } }),
      prisma.bug.count({ where: { ...scope, archivedAt: null, createdAt: { gte: from } } }),
      prisma.release.count({ where: { ...scope, status: "released", releasedAt: { gte: monthFrom } } }),
      prisma.release.count({ where: { ...scope, status: "released", releasedAt: { gte: prevMonthFrom, lt: monthFrom } } }),
      prisma.requirement.findMany({
        where: { ...scope, archivedAt: null, plannedEndAt: { lt: now }, status: { notIn: ["online", "cancelled"] } },
        include: { project: { select: { key: true } } },
        orderBy: { plannedEndAt: "asc" },
        take: 3,
      }),
      prisma.bug.findMany({
        where: { ...scope, archivedAt: null, severity: "blocker", status: { notIn: ["closed", "cancelled", "resolved"] } },
        include: { project: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 3,
      }),
      prisma.bug.findMany({
        where: { ...scope, archivedAt: null, assigneeId: null, status: { notIn: ["closed", "cancelled", "resolved"] } },
        orderBy: { createdAt: "asc" },
        take: 3,
      }),
      prisma.release.findMany({
        where: { ...scope, OR: [{ status: { in: [...RELEASE_OPEN_STATUSES] } }, { status: "released", releasedAt: { gte: subWeeks(now, 1) } }] },
        include: { project: { select: { name: true } } },
        orderBy: [{ plannedAt: "asc" }],
        take: 5,
      }),
    ]);

  return { allProjects, projectId, projects, onlineNow, onlinePrev, activeReqs, openBugs, newBugs, relNow, relPrev, overdue, blockers, unassigned, upcoming };
}
