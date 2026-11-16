import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeBug } from "../access";

export async function findBugForPage(id: string) {
  const b = await prisma.bug.findUnique({
    where: { id: id },
    include: {
      project: { select: { id: true, name: true, iconUrl: true, productId: true } },
      requirement: { select: { id: true, title: true, status: true, project: { select: { key: true } } } },
      frontend: { select: { id: true, name: true, avatarUrl: true } },
      backend: { select: { id: true, name: true, avatarUrl: true } },
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      creator: { select: { name: true, avatarUrl: true } },
      comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  return b;
}

export async function loadBugPageDetails(session: SessionUser, b: NonNullable<Awaited<ReturnType<typeof findBugForPage>>>) {
  const [canEditRaw, canDeleteRaw, logs] = await Promise.all([
    can(session, "bugs.edit", b.projectId),
    can(session, "bugs.delete", b.projectId),
    prisma.activityLog.findMany({
      where: { entityType: "bug", entityId: b.id },
      include: { actor: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);
  return { canEditRaw, canDeleteRaw, logs };
}

export async function canViewBugPage(session: SessionUser, bug: NonNullable<Awaited<ReturnType<typeof findBugForPage>>>) {
  return canSeeBug(session, bug);
}
