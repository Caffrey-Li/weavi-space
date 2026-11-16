/**
 * 将旧需求状态迁移到新阶段体系：
 * 未填→需求中, 开发完→开发完成, 已完成→测试完成,
 * 已上线【内测版】→已上线, 已上线→已上线, 已取消→已取消
 * 以及英文遗留：todo/in_progress/in_test/ready_for_release/done/cancelled
 * 11-06 起目标是英文 key（req_in_progress … cancelled），中文名也会被换掉；SQLite 搬到 PostgreSQL 时 scripts/migrate-sqlite-to-pg.ts 已自动做过。
 */
import { PrismaClient } from "@prisma/client";
import { REQ_STATUS_LEGACY_MAP } from "../apps/web/src/lib/constants";

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.requirement.groupBy({ by: ["status"], _count: true });
  console.log("Before:", groups);

  for (const [from, to] of Object.entries(REQ_STATUS_LEGACY_MAP)) {
    if (from === to) continue;
    const r = await prisma.requirement.updateMany({
      where: { status: from },
      data: { status: to },
    });
    if (r.count) console.log(`${from} → ${to}: ${r.count}`);
  }

  const after = await prisma.requirement.groupBy({ by: ["status"], _count: true });
  console.log("After:", after);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
