import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canMany } from "../permissions";
import { loadReleasePlans } from "../shared/release-plans";

export async function findProjectOverview(id: string) {
  const p = await prisma.project.findUnique({
    where: { id: id },
    include: {
      members: { include: { user: true } },
      resources: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  return p;
}

export async function loadProjectOverviewData(session: SessionUser | null, projectId: string) {
  const [perms, statusCounts, openBugs, blockers, recent] = await Promise.all([
    canMany(session, ["project.edit", "board.move"] as const, projectId),
    prisma.requirement.groupBy({ by: ["status"], where: { projectId: projectId, archivedAt: null }, _count: true }),
    prisma.bug.count({ where: { projectId: projectId, archivedAt: null, status: { notIn: ["closed", "cancelled"] } } }),
    prisma.bug.count({ where: { projectId: projectId, archivedAt: null, severity: "blocker", status: { notIn: ["closed", "cancelled"] } } }),
    prisma.requirement.findMany({
      where: { projectId: projectId, archivedAt: null },
      include: { project: true, assignees: { include: { user: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
  ]);

  const plans = await loadReleasePlans(projectId);
  return { perms, statusCounts, openBugs, blockers, recent, plans };
}
