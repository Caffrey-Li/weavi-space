import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { bugWhere, getAccess, projectWhere, requirementWhere } from "../access";
import { REQ_STATUS } from "../shared/constants";

export type StageKey = "req" | "dev" | "test" | "online";
export type ProjectBoardRow = {
  id: string;
  name: string;
  key: string;
  iconUrl: string | null;
  stages: Record<StageKey, number>;
  total: number;
  openBugs: number;
  overdue: number;
};

const STAGE_OF = new Map<string, string>(REQ_STATUS.map((s) => [s.key, s.stage]));

/**
 * 全局看板（按项目汇总）：每个进行中项目的需求按阶段计数、未关闭 Bug、逾期需求。
 * 只统计当前用户数据范围内的需求和 Bug；项目明细在「项目看板」。
 */
export async function loadBoardSummary(session: SessionUser | null) {
  if (!session) return { rows: [] as ProjectBoardRow[] };
  const access = await getAccess(session);
  const projects = await prisma.project.findMany({
    where: { status: "active", ...projectWhere(access) },
    select: { id: true, name: true, key: true, iconUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { rows: [] as ProjectBoardRow[] };
  const now = new Date();
  const [reqs, bugs, overdue] = await Promise.all([
    prisma.requirement.groupBy({
      by: ["projectId", "status"],
      where: { archivedAt: null, projectId: { in: ids }, status: { not: "cancelled" }, AND: [requirementWhere(access)] },
      _count: { _all: true },
    }),
    prisma.bug.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, status: { in: ["open", "in_progress", "reopened"] }, AND: [bugWhere(access)] },
      _count: { _all: true },
    }),
    prisma.requirement.groupBy({
      by: ["projectId"],
      where: { archivedAt: null, projectId: { in: ids }, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { lt: now }, AND: [requirementWhere(access)] },
      _count: { _all: true },
    }),
  ]);
  const rows: ProjectBoardRow[] = projects.map((p) => {
    const stages: Record<StageKey, number> = { req: 0, dev: 0, test: 0, online: 0 };
    for (const g of reqs) {
      if (g.projectId !== p.id) continue;
      const st = STAGE_OF.get(g.status) as StageKey | undefined;
      if (st && st in stages) stages[st] += g._count._all;
    }
    return {
      ...p,
      stages,
      total: stages.req + stages.dev + stages.test + stages.online,
      openBugs: bugs.find((b) => b.projectId === p.id)?._count._all || 0,
      overdue: overdue.find((o) => o.projectId === p.id)?._count._all || 0,
    };
  });
  return { rows };
}
