import PgBoss from "pg-boss";
import { enqueueDueSchedules, runQueuedSchedule } from "./schedules";
import { enqueueDueTableSync, runQueuedTableSync } from "./feishu-table-auto";
import { purgeExpiredForQueue } from "./lifecycle";
import { sendDueReports } from "./report-send";
import { runDueScheduleRules } from "@pm-collab/core/agent/rules";
import { autoUpdateTick } from "@pm-collab/core/skills/updater";
import { ensureAgent } from "./agent-runner";
import { runDueCloudDocSync } from "@pm-collab/core/cloud-docs/service";

const QUEUE = {
  reminderScan: "nova-reminder-scan",
  reminder: "nova-reminder",
  tableScan: "nova-table-scan",
  tableSync: "nova-table-sync",
  purgeScan: "nova-purge-scan",
  purge: "nova-purge",
  reportScan: "nova-report-scan",
  agentRuleScan: "nova-agent-rule-scan",
  skillUpdate: "nova-skill-update",
  cloudDocScan: "nova-clouddoc-scan",
} as const;
const RETRIES = { policy: "exclusive" as const, retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 };
type Item = { id: string; scheduledAt: string };
const globalQueue = globalThis as unknown as { __novaBoss?: Promise<PgBoss>; __novaBossRetry?: ReturnType<typeof setTimeout> };

async function initialize() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少数据库连接配置");
  const boss = new PgBoss({ connectionString, schema: "nova_jobs" });
  boss.on("error", () => console.error("[任务队列] 数据库或队列发生错误"));
  try {
    await boss.start();
    for (const name of Object.values(QUEUE)) await boss.createQueue(name, { ...RETRIES, ...(name === QUEUE.purge ? { deleteAfterSeconds: 172800 } : {}) });
    await boss.work(QUEUE.reminderScan, async () => { await enqueueDueSchedules(); });
    await boss.work<Item>(QUEUE.reminder, async (jobs) => { for (const job of jobs) await runQueuedSchedule(job.data.id, job.data.scheduledAt); });
    await boss.work(QUEUE.tableScan, async () => { await enqueueDueTableSync(); });
    await boss.work<Item>(QUEUE.tableSync, async (jobs) => { for (const job of jobs) await runQueuedTableSync(job.data.id, job.data.scheduledAt); });
    await boss.work(QUEUE.purgeScan, async () => {
      const { rows } = await boss.getDb().executeSql(
        "SELECT max(coalesce(started_on, created_on)) AS last_run FROM nova_jobs.job WHERE name = $1",
        [QUEUE.purge],
      );
      const last = rows[0]?.last_run ? new Date(rows[0].last_run).getTime() : 0;
      if (!last || Date.now() - last > 3600_000) await boss.send(QUEUE.purge, {});
    });
    await boss.work(QUEUE.reportScan, async () => {
      const n = await sendDueReports();
      if (n) console.log(`[周报] 已定时发送 ${n} 个项目的周报`);
    });
    await boss.work(QUEUE.agentRuleScan, async () => {
      ensureAgent();
      const n = await runDueScheduleRules();
      if (n) console.log(`[自动化] 定时规则发起 ${n} 个任务`);
    });
    // 内置 skill 自动更新：每小时看一次，距上次检查满 24 小时才连 GitHub（autoUpdateTick 里判断）
    await boss.work(QUEUE.skillUpdate, async () => {
      const r = await autoUpdateTick();
      if (r && !r.ok) console.error(`[内置能力] 自动检查更新失败：${r.error}`);
    });
    // 云文档每天自动同步（T33）：每小时看一次，距上次自动同步满 24 小时的连接才执行
    await boss.work(QUEUE.cloudDocScan, async () => {
      const n = await runDueCloudDocSync();
      if (n) console.log(`[云文档] 自动同步了 ${n} 个连接`);
    });
    await boss.work(QUEUE.purge, async () => {
      const n = await purgeExpiredForQueue();
      if (n) console.log(`[回收站] 已自动彻底删除 ${n} 项超过保留期的内容`);
    });
    for (const name of [QUEUE.reminderScan, QUEUE.tableScan, QUEUE.purgeScan, QUEUE.reportScan, QUEUE.agentRuleScan]) {
      await boss.schedule(name, "* * * * *");
      await boss.sendAfter(name, {}, {}, 5);
    }
    await boss.schedule(QUEUE.skillUpdate, "23 * * * *");
    await boss.sendAfter(QUEUE.skillUpdate, {}, {}, 60);
    await boss.schedule(QUEUE.cloudDocScan, "41 * * * *");
    await boss.sendAfter(QUEUE.cloudDocScan, {}, {}, 90);
    return boss;
  } catch (e) {
    await boss.stop().catch(() => undefined);
    throw e;
  }
}

export function startJobScheduler(): Promise<PgBoss> {
  if (!globalQueue.__novaBoss) {
    if (globalQueue.__novaBossRetry) {
      clearTimeout(globalQueue.__novaBossRetry);
      delete globalQueue.__novaBossRetry;
    }
    globalQueue.__novaBoss = initialize().catch((error) => {
      delete globalQueue.__novaBoss;
      console.error("[定时任务] 队列启动失败，60 秒后重试", error);
      globalQueue.__novaBossRetry = setTimeout(() => {
        delete globalQueue.__novaBossRetry;
        void startJobScheduler().catch(() => undefined);
      }, 60_000);
      globalQueue.__novaBossRetry.unref?.();
      throw error;
    });
  }
  return globalQueue.__novaBoss;
}

export async function enqueueReminder(id: string, now: Date) {
  const boss = await startJobScheduler();
  return boss.send(QUEUE.reminder, { id, scheduledAt: now.toISOString() }, { singletonKey: id });
}

export async function enqueueTableSync(id: string, now: Date) {
  const boss = await startJobScheduler();
  return boss.send(QUEUE.tableSync, { id, scheduledAt: now.toISOString() }, { singletonKey: id });
}
