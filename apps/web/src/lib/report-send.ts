import { prisma } from "./prisma";
import { dueReports } from "@pm-collab/core/reports/service";
import { botEvents, buildCard, deliver, siteUrl } from "./feishu-bot";

/** 周报定时发送（任务队列每分钟扫一次）：站内通知给项目成员；订阅了「项目周报」的人同时推飞书机器人 */
export async function sendDueReports() {
  const list = await dueReports();
  for (const r of list) {
    if (!r.memberIds.length) continue;
    const title = `${r.projectName} 周报（${r.week} 那周）`;
    const body = r.report
      ? [r.report.progress !== null ? `进度 ${r.report.progress}%` : "", r.report.done && `本周完成：\n${r.report.done}`, r.report.next && `下周计划：\n${r.report.next}`, r.report.risks && `风险：\n${r.report.risks}`].filter(Boolean).join("\n\n")
      : "本周还没有写周报。";
    const href = r.productId ? `/products/${r.productId}?tab=projects` : `/projects/${r.projectId}`;
    await prisma.notification.createMany({ data: r.memberIds.map((userId) => ({ userId, kind: "project_report", title, body: body.slice(0, 1000), href, entityType: "project", entityId: r.projectId })) });
    const bots = await prisma.userBot.findMany({ where: { userId: { in: r.memberIds }, OR: [{ webhookOn: true }, { dmOn: true }] } });
    const card = buildCard({ title, lines: [body.slice(0, 1500)], url: siteUrl(href), tone: "blue" });
    for (const b of bots) if (botEvents(b.events).includes("project_report")) await deliver(b.userId, card).catch((e) => console.error("[周报] 推送失败", e));
  }
  return list.length;
}
