import { reqCodeOf } from "../shared/codes";
import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, projectWhere, requirementWhere, type Access } from "../access";

export async function loadBoardContext(session: SessionUser | null, projectId: string) {
  const access = session ? await getAccess(session) : null;
  const projects = await prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, orderBy: { createdAt: "asc" } });
  const project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
  return { access, projects, project };
}

export async function loadBoardCards(access: Access | null, projects: Awaited<ReturnType<typeof loadBoardContext>>["projects"], projectId: string, iterationId?: string | null) {
  const requirements = await prisma.requirement.findMany({
    where: {
      archivedAt: null,
      // T43 Scrum：只看某个迭代
      ...(iterationId ? { iterationId } : {}),
      status: { not: "cancelled" },
      projectId: projectId || { in: projects.length ? projects.map((p) => p.id) : ["__none__"] },
      AND: [access ? requirementWhere(access) : { id: "__none__" }],
    },
    include: { project: true, assignees: { include: { user: true } } },
    orderBy: { boardOrder: "asc" },
  });

  const cards = requirements.map((r) => {
    const people = r.assignees
      .filter((a, i, arr) => arr.findIndex((x) => x.userId === a.userId) === i)
      .map((a) => ({ id: a.userId, name: a.user.name }));
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      boardOrder: r.boardOrder,
      projectId: r.projectId,
      projectName: r.project?.name,
      assignees: people.map((p) => p.name),
      assigneeIds: people.map((p) => p.id),
      code: reqCodeOf(r),
      plannedEndAt: r.plannedEndAt ? r.plannedEndAt.toISOString() : null,
    };
  });
  return cards;
}
