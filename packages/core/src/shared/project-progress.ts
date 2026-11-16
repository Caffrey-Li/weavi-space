import { prisma } from "@pm-collab/db/prisma";

/** 各项目「已上线 / 全部需求（不含已取消）」，用于项目卡进度 */
export async function projectProgress(projectIds: string[]) {
  const map = new Map<string, { done: number; all: number }>();
  if (!projectIds.length) return map;
  const rows = await prisma.requirement.groupBy({
    by: ["projectId", "status"],
    where: { archivedAt: null, projectId: { in: projectIds }, status: { not: "cancelled" } },
    _count: true,
  });
  for (const g of rows) {
    if (!g.projectId) continue;
    const cur = map.get(g.projectId) || { done: 0, all: 0 };
    cur.all += g._count;
    if (g.status === "online") cur.done += g._count;
    map.set(g.projectId, cur);
  }
  return map;
}
