import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { bugWhere, getAccess, projectWhere } from "../access";
import { canMany } from "../permissions";

export async function loadBugList(session: SessionUser | null, { mine, projectId, q, statusFilter, stage, stageStatuses, tab, page, pageSize, focusedId }: { mine: boolean; projectId: string; q: string; statusFilter: string; stage: string; stageStatuses: string[]; tab: string; page: number; pageSize: number; focusedId?: string }) {
  const access = session ? await getAccess(session) : null;
  const base: Record<string, unknown> = { archivedAt: null, AND: [access ? bugWhere(access) : { id: "__none__" }] };
  // 我的 Bug：处理人、前端负责人、后端负责人任一是我
  if (mine) (base.AND as unknown[]).push({ OR: [{ assigneeId: session?.id ?? "__none__" }, { frontendId: session?.id ?? "__none__" }, { backendId: session?.id ?? "__none__" }] });
  if (projectId) base.projectId = projectId;
  if (q) base.title = { contains: q, mode: "insensitive" };
  const where: Record<string, unknown> = { ...base };
  if (statusFilter) where.status = statusFilter;
  else if (stage) where.status = { in: stageStatuses };

  const include = {
    project: true,
    assignee: true,
    frontend: { select: { id: true, name: true, avatarUrl: true } },
    backend: { select: { id: true, name: true, avatarUrl: true } },
    requirement: { select: { id: true, title: true, project: { select: { key: true } } } },
  } as const;
  const [bugs, total, byStatus, projects, perms, focused] = await Promise.all([
    prisma.bug.findMany({
      where,
      include,
      orderBy: tab === "board" ? [{ boardOrder: "asc" }] : [{ updatedAt: "desc" }],
      ...(tab === "list" ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    tab === "list" ? prisma.bug.count({ where }) : Promise.resolve(0),
    prisma.bug.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, orderBy: { createdAt: "asc" } }),
    canMany(session, ["bugs.edit", "bugs.delete"] as const, projectId || undefined),
    focusedId ? prisma.bug.findFirst({ where: { id: focusedId, AND: [access ? bugWhere(access) : { id: "__none__" }] }, include }) : Promise.resolve(null),
  ]);
  return { bugs, total, byStatus, projects, perms, focused };
}

export async function findBugListProject(projectId: string) {
  const project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
  return project;
}
