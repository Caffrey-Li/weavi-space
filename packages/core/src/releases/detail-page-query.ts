import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canMany } from "../permissions";
import { canSeeProject, bugWhere, getAccess } from "../access";

export async function findReleaseForPage(id: string) {
  const release = await prisma.release.findUnique({
    where: { id: id },
    include: {
      project: true,
      creator: true,
      items: {
        include: { requirement: { include: { project: true, assignees: { include: { user: true } } } } },
        orderBy: { sortOrder: "asc" },
      },
      bugs: { orderBy: { createdAt: "asc" } },
    },
  });
  return release;
}

export async function canViewReleasePage(session: SessionUser, projectId: string) {
  return canSeeProject(session, projectId);
}

export async function loadReleasePageDetails(session: SessionUser, release: NonNullable<Awaited<ReturnType<typeof findReleaseForPage>>>) {
  const perms = await canMany(session, ["releases.manage", "board.move"] as const, release.projectId);
  // 关联的 Bug（紧急发版修复的线上问题）：只显示当前账号能看到的
  const bugs = release.bugs.length
    ? await prisma.bug.findMany({
        where: { id: { in: release.bugs.map((b) => b.bugId) }, AND: [bugWhere(await getAccess(session))] },
        select: { id: true, title: true, status: true, severity: true, environment: true, assignee: { select: { name: true, avatarUrl: true } } },
      })
    : [];
  return { perms, bugs };
}
