import { prisma } from "./prisma";
import { canSyncLink, runLinkSync } from "./feishu-table-links";

/**
 * 飞书表格单向自动同步（11-05）：连接设了「自动拉取」或「自动回写」时，按间隔直接执行（不预览）。
 * 由后台任务每分钟调用一次；以连接创建人的身份和权限执行，创建人停用或没有权限时跳过并记一条失败记录。
 * lastAutoAt 做乐观锁：多个进程同时检查也只有一个执行。一次只跑一个连接，跑完再看下一个。
 */
let running = false;

export async function runAutoTableSync(now = new Date()) {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    const links = await prisma.feishuTableLink.findMany({ where: { autoSync: { in: ["pull", "push"] } }, orderBy: { lastAutoAt: "asc" } });
    for (const link of links) {
      const every = Math.max(15, link.autoEvery || 60) * 60_000;
      if (link.lastAutoAt && now.getTime() - link.lastAutoAt.getTime() < every - 30_000) continue;
      const locked = await prisma.feishuTableLink.updateMany({ where: { id: link.id, lastAutoAt: link.lastAutoAt }, data: { lastAutoAt: now } });
      if (!locked.count) continue;
      const pull = link.autoSync === "pull";
      if (!pull && !link.lastPullAt) continue; // 首次同步必须先拉取
      const owner = await prisma.user.findUnique({ where: { id: link.createdById }, select: { id: true, name: true, globalRole: true, isActive: true } });
      if (!owner?.isActive) {
        console.warn(`[飞书表格] 自动同步跳过「${link.name}」：创建人已停用`);
        continue;
      }
      try {
        if (!(await canSyncLink(owner, link, pull))) throw new Error("创建人没有这个范围的权限");
        await runLinkSync(link, owner, pull, { auto: true });
        n++;
      } catch (e) {
        // runLinkSync 已记录失败；权限不足时这里补一条
        if (e instanceof Error && e.message === "创建人没有这个范围的权限") {
          await prisma.activityLog
            .create({
              data: {
                entityType: "feishu_table",
                entityId: link.id,
                action: "table_sync",
                actorId: owner.id,
                message: `自动${pull ? "拉取" : "回写"} · ${link.name}　失败（${e.message}）`,
                toValue: JSON.stringify({ direction: pull ? "pull" : "push", auto: true, error: true, errors: [e.message] }),
              },
            })
            .catch(() => {});
        }
        console.error(`[飞书表格] 自动同步「${link.name}」失败`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    running = false;
  }
  return n;
}

export async function enqueueDueTableSync(now = new Date()) {
  let n = 0;
  const links = await prisma.feishuTableLink.findMany({ where: { autoSync: { in: ["pull", "push"] } }, orderBy: { lastAutoAt: "asc" } });
  const { enqueueTableSync } = await import("./scheduler-queue");
  for (const link of links) {
    const every = Math.max(15, link.autoEvery || 60) * 60_000;
    if (link.lastAutoAt && now.getTime() - link.lastAutoAt.getTime() < every - 30_000) continue;
    if (await enqueueTableSync(link.id, now)) n++;
  }
  return n;
}

export async function runQueuedTableSync(id: string, scheduledAt: string) {
  const now = new Date(scheduledAt);
  const link = await prisma.feishuTableLink.findUnique({ where: { id } });
  if (!link || !["pull", "push"].includes(link.autoSync)) return;
  if (link.lastAutoAt?.getTime() !== now.getTime()) {
    const every = Math.max(15, link.autoEvery || 60) * 60_000;
    if (link.lastAutoAt && now.getTime() - link.lastAutoAt.getTime() < every - 30_000) return;
    const claimed = await prisma.feishuTableLink.updateMany({ where: { id, lastAutoAt: link.lastAutoAt }, data: { lastAutoAt: now } });
    if (!claimed.count) return;
  }
  const pull = link.autoSync === "pull";
  if (!pull && !link.lastPullAt) return; // 首次同步必须先拉取
  const owner = await prisma.user.findUnique({ where: { id: link.createdById }, select: { id: true, name: true, globalRole: true, isActive: true } });
  if (!owner?.isActive) {
    console.warn(`[飞书表格] 自动同步跳过「${link.name}」：创建人已停用`);
    return;
  }
  try {
    if (!(await canSyncLink(owner, link, pull))) throw new Error("创建人没有这个范围的权限");
    await runLinkSync(link, owner, pull, { auto: true });
  } catch (e) {
    if (e instanceof Error && e.message === "创建人没有这个范围的权限") {
      await prisma.activityLog.create({
        data: {
          entityType: "feishu_table", entityId: link.id, action: "table_sync", actorId: owner.id,
          message: `自动${pull ? "拉取" : "回写"} · ${link.name}　失败（${e.message}）`,
          toValue: JSON.stringify({ direction: pull ? "pull" : "push", auto: true, error: true, errors: [e.message] }),
        },
      }).catch(() => {});
    }
    throw e;
  }
}
