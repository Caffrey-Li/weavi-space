import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canMany } from "../permissions";

export async function findRequirementForPage(id: string) {
  const r = await prisma.requirement.findUnique({
    where: { id: id },
    include: {
      project: true,
      creator: true,
      proposer: { select: { name: true, avatarUrl: true } },
      parent: { include: { project: { select: { key: true } } } },
      assignees: true,
      children: {
        where: { archivedAt: null },
        include: { project: { select: { key: true } }, assignees: { where: { role: "product" }, include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
      bugs: { where: { archivedAt: null }, include: { assignee: true }, orderBy: { updatedAt: "desc" }, take: 30 },
      releaseItems: { include: { release: true } },
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return r;
}

export async function loadRequirementPageDetails(session: SessionUser, r: NonNullable<Awaited<ReturnType<typeof findRequirementForPage>>>) {
  const [perms, logs] = await Promise.all([
    canMany(session, ["board.move", "requirements.edit", "requirements.create", "bugs.edit"] as const, r.projectId),
    prisma.activityLog.findMany({
      where: { entityType: "requirement", entityId: r.id },
      include: { actor: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  ]);
  return { perms, logs };
}
