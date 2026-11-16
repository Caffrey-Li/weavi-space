import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, inProjectsWhere, projectWhere } from "../access";
import { canMany } from "../permissions";
import { RELEASE_OPEN_STATUSES } from "../shared/constants";
import { ensureAllScheduledReleases, ensureScheduledReleases, getReleaseSchedule } from "./schedule";

export async function loadReleaseList(session: SessionUser | null, { projectId, status, q, kind, asc, page, pageSize }: { projectId: string; status: string; q: string; kind: string; asc: boolean; page: number; pageSize: number }) {
  const access = session ? await getAccess(session) : null;
  // 固定发版：按节奏补齐未来的计划（按需生成，Netlify 上也可用）
  if (projectId) await ensureScheduledReleases(projectId);
  else if (access) await ensureAllScheduledReleases(access.projectIds);
  const schedule = projectId ? await getReleaseSchedule(projectId) : null;
  const where: Record<string, unknown> = { AND: [access ? inProjectsWhere(access) : { id: "__none__" }] };
  if (projectId) where.projectId = projectId;
  if (status === "open") where.status = { in: [...RELEASE_OPEN_STATUSES] };
  else if (status) where.status = status;
  if (q) where.OR = [{ version: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }];
  if (kind) where.kind = kind;

  const [total, releases, projects, perms] = await Promise.all([
    prisma.release.count({ where }),
    prisma.release.findMany({
      where,
      include: { project: true, creator: true, items: { include: { requirement: { select: { status: true } } } } },
      orderBy: [{ plannedAt: asc ? "asc" : "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, orderBy: { createdAt: "asc" } }),
    canMany(session, ["releases.manage"] as const, projectId || undefined),
  ]);
  const project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
  return { total, releases, projects, perms, project, schedule };
}
