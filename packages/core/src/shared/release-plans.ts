import { prisma } from "@pm-collab/db/prisma";
import { isReqDone, normalizeReqStatus, reqStatusLabel } from "./constants";
import type { PlanRow } from "./release-plans-shared";
import { ensureScheduledReleases } from "../releases/schedule";
export * from "./release-plans-shared";

/**
 * 上线计划 = 项目里的发版（Release）。一个项目可以有多个上线计划；
 * 需求加入计划后，按需求状态统计「实际完成」（状态为「已上线」即完成，已取消的需求不计入）。
 */
export async function loadReleasePlans(projectId: string): Promise<PlanRow[]> {
  // 固定发版节奏：按需补齐未来的计划
  await ensureScheduledReleases(projectId);
  const rows = await prisma.release.findMany({
    where: { projectId, status: { not: "cancelled" } },
    include: {
      project: { select: { key: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        include: { requirement: { select: { id: true, title: true, status: true, actualEndAt: true, archivedAt: true } } },
      },
    },
  });
  const plans = rows.map((r) => {
    const reqs = r.items
      .map((i) => i.requirement)
      .filter((q) => !q.archivedAt && normalizeReqStatus(q.status) !== "cancelled")
      .map((q) => ({
        id: q.id,
        code: `${r.project.key}-${q.id.slice(-4).toUpperCase()}`,
        title: q.title,
        status: normalizeReqStatus(q.status),
        statusLabel: reqStatusLabel(normalizeReqStatus(q.status)),
        doneAt: q.actualEndAt ? q.actualEndAt.toISOString() : null,
      }));
    const doneReqs = reqs.filter((q) => isReqDone(q.status)).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
    const openReqs = reqs.filter((q) => !isReqDone(q.status));
    return {
      id: r.id,
      version: r.version,
      title: r.title || "",
      status: r.status,
      plannedAt: r.plannedAt ? r.plannedAt.toISOString() : null,
      releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      done: doneReqs.length,
      total: reqs.length,
      pct: reqs.length ? Math.round((doneReqs.length / reqs.length) * 100) : 0,
      doneReqs,
      openReqs,
    };
  });
  // 按计划上线日期排序（没有日期的排在最后）
  return plans.sort((a, b) => (a.plannedAt || "9999").localeCompare(b.plannedAt || "9999") || a.createdAt.localeCompare(b.createdAt));
}

