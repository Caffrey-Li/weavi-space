import { prisma } from "./prisma";

/**
 * 启动自检：数据库是否已执行迁移（表结构只由 prisma/migrations 管理，启动代码不再建表加列）。
 * 没执行时打印处理办法并返回 false，后面的数据校正就不跑了（页面会因为缺表报错，按提示执行迁移后重启即可）。
 */
export async function checkDatabaseReady(): Promise<boolean> {
  try {
    await prisma.workspace.count();
  } catch (e) {
    console.error("[启动] 数据库还没有执行迁移或连不上：请先运行 `npx prisma migrate deploy`，再重启服务。", e instanceof Error ? e.message : e);
    return false;
  }
  try {
    const failed = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if (Number(failed[0]?.n ?? 0) > 0) console.error("[启动] 有执行失败的数据库迁移，请用 `npx prisma migrate status` 查看并处理");
  } catch {
    console.warn("[启动] 没有找到迁移记录表 _prisma_migrations：请确认数据库是用 `npx prisma migrate deploy` 建的");
  }
  return true;
}
