import { prisma } from "@pm-collab/db/prisma";

const DONE = ["resolved", "closed", "cancelled"];

/**
 * Bug 状态变了之后调用：如果它属于需求交付最近一轮测试，且这一轮的 Bug 都已解决 / 关闭，通知发起人提交回归。
 * 只依赖 prisma，避免和 Bug 服务互相引用。失败只记日志。
 */
export async function onBugStatusChanged(bugId: string, status: string) {
  try {
    if (!DONE.includes(status)) return;
    const res = await prisma.deliveryResult.findFirst({ where: { bugId, voided: false, run: { kind: "round", status: "finalized" } }, include: { run: true }, orderBy: { run: { round: "desc" } } });
    if (!res) return;
    const latest = await prisma.deliveryRun.findFirst({ where: { deliveryId: res.run.deliveryId, kind: "round", status: "finalized" }, orderBy: { round: "desc" } });
    if (!latest || latest.id !== res.runId) return;
    const ids = (await prisma.deliveryResult.findMany({ where: { runId: latest.id, voided: false, bugId: { not: null } }, select: { bugId: true } })).map((r) => r.bugId!);
    const open = await prisma.bug.count({ where: { id: { in: ids }, status: { notIn: DONE } } });
    if (open) return;
    const d = await prisma.delivery.findUnique({ where: { id: latest.deliveryId } });
    if (!d) return;
    const href = `/docs/${d.projectId}/pages/${d.prdPageId || d.sourcePageId}`;
    await prisma.notification.create({ data: { userId: latest.createdById, kind: "system", title: `第 ${latest.round} 轮的 Bug 都已解决，可以提交回归`, body: `共 ${ids.length} 个 Bug。打开「需求交付」面板提交回归。`, href, entityType: "doc" } });
  } catch (e) {
    console.error("[需求交付] Bug 状态通知失败", e);
  }
}
