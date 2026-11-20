import { prisma } from "./prisma";
import { SEVERITY_LABELS, reqStatusLabel } from "./constants";
import { botEvents, buildCard, deliver, siteUrl, type BotEvent } from "./feishu-bot";
import { currentAgentContext } from "@pm-collab/core/agent/context";
import { onActivityForRules } from "@pm-collab/core/agent/rules";
import { ensureAgent } from "./agent-runner";

/**
 * 动态 → 个人机器人通知。由 prisma.ts 在每次写入 ActivityLog 后异步调用，失败只记日志、不影响业务。
 * 收件人按事件订阅筛选；自己做的改动不通知自己（「飞书表格同步完成」除外，它本来就是发给发起人的）。
 */
type Log = { entityType: string; entityId: string; action: string; actorId: string | null; message: string | null; toValue?: string | null };

const NOTIFY_ACTIONS = new Set(["created", "updated", "status_changed", "deleted", "table_sync"]);

export async function notifyActivity(log: Log) {
  // 自动化规则（T27 二期）：先取调用上下文（这条动态是不是小围的操作写的、第几层），再异步匹配规则
  const agentCtx = currentAgentContext();
  ensureAgent();
  void onActivityForRules(log, agentCtx).catch((e) => console.error("[自动化] 触发规则失败", e));
  // T39 提测自动执行：需求进入「待测试」时，开了自动执行的需求交付自动发起一轮测试
  if (log.entityType === "requirement" && log.action === "status_changed" && log.toValue) {
    try {
      if ((JSON.parse(log.toValue) as { status?: string }).status === "test_todo") {
        void import("@pm-collab/core/delivery/service").then((m) => m.onRequirementReadyForTest(log.entityId)).catch((e) => console.error("[需求交付] 提测自动执行失败", e));
      }
    } catch {
      // toValue 不是 JSON 时忽略
    }
  }
  if (!NOTIFY_ACTIONS.has(log.action)) return;
  const actor = log.actorId ? await prisma.user.findUnique({ where: { id: log.actorId }, select: { name: true } }) : null;
  const who = actor?.name || "系统";
  // userId → 命中的事件
  const targets = new Map<string, BotEvent>();
  const add = (ids: (string | null | undefined)[], ev: BotEvent) => {
    for (const id of ids) if (id && (id !== log.actorId || ev === "table_sync") && !targets.has(id)) targets.set(id, ev);
  };
  const members = async (projectId: string | null | undefined) =>
    projectId ? (await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } })).map((m) => m.userId) : [];
  let title = "";
  let lines: string[] = [];
  let url: string | undefined;
  let tone: "blue" | "green" | "orange" | "red" | "grey" = "blue";

  if (log.entityType === "requirement") {
    const r = await prisma.requirement.findUnique({
      where: { id: log.entityId },
      select: { title: true, status: true, projectId: true, creatorId: true, proposerId: true, plannedEndAt: true, project: { select: { name: true } }, assignees: { select: { userId: true } } },
    });
    if (!r) return;
    add(r.assignees.map((a) => a.userId), "req_assigned");
    if (log.action === "status_changed") add([r.creatorId, r.proposerId], "req_mine");
    if (log.action === "created") add(await members(r.projectId), "project_new");
    title = log.action === "created" ? `新需求：${r.title}` : log.action === "deleted" ? `需求已删除：${r.title}` : `需求更新：${r.title}`;
    lines = [`**${who}** ${log.message || "更新了需求"}`, `项目：${r.project?.name || "未归属"} · 当前状态：${reqStatusLabel(r.status)}`];
    url = log.action === "deleted" ? undefined : siteUrl(`/requirements/${log.entityId}`);
    tone = log.action === "deleted" ? "grey" : r.status === "online" ? "green" : "blue";
  } else if (log.entityType === "bug") {
    const b = await prisma.bug.findUnique({ where: { id: log.entityId }, select: { title: true, status: true, severity: true, projectId: true, assigneeId: true, frontendId: true, backendId: true, project: { select: { name: true } } } });
    if (!b) return;
    add([b.assigneeId, b.frontendId, b.backendId], "bug_assigned");
    if (log.action === "created") add(await members(b.projectId), "project_new");
    title = log.action === "created" ? `新 Bug：${b.title}` : `Bug 更新：${b.title}`;
    lines = [`**${who}** ${log.message || "更新了 Bug"}`, `项目：${b.project?.name || "未归属"} · 严重程度：${SEVERITY_LABELS[b.severity] || b.severity}`];
    url = siteUrl(`/bugs?bug=${log.entityId}`);
    tone = log.action === "created" ? "red" : "orange";
  } else if (log.entityType === "release") {
    if (log.action !== "status_changed") return;
    const rel = await prisma.release.findUnique({ where: { id: log.entityId }, select: { version: true, title: true, projectId: true, project: { select: { name: true } } } });
    if (!rel) return;
    add(await members(rel.projectId), "release");
    title = `上线计划 v${rel.version}${rel.title ? ` ${rel.title}` : ""}`;
    lines = [`**${who}** ${log.message || "更新了上线计划状态"}`, `项目：${rel.project.name}`];
    url = siteUrl(`/projects/${rel.projectId}/plans`);
    tone = "green";
  } else if (log.entityType === "feishu_table" && log.action === "table_sync") {
    add([log.actorId], "table_sync");
    title = "飞书表格同步完成";
    lines = [log.message || ""];
    url = siteUrl("/system/feishu-tables");
  } else return;

  if (!targets.size) return;
  // 站内通知：每个收件人一条（铃铛里看）；飞书机器人按各人的订阅再推一次
  const href = url ? url.replace(/^https?:\/\/[^/]+/, "") : null;
  await prisma.notification.createMany({
    data: Array.from(targets.entries()).map(([userId, kind]) => ({ userId, kind, title: title.slice(0, 200), body: lines.join("\n").replace(/\*\*/g, "").slice(0, 500), href, entityType: log.entityType, entityId: log.entityId, actorId: log.actorId })),
  });
  const bots = await prisma.userBot.findMany({ where: { userId: { in: Array.from(targets.keys()) }, OR: [{ webhookOn: true }, { dmOn: true }] } });
  const card = buildCard({ title, lines, url, tone });
  for (const bot of bots) {
    const ev = targets.get(bot.userId)!;
    if (!botEvents(bot.events).includes(ev)) continue;
    await deliver(bot.userId, card).catch((e) => console.error("[通知] 发送失败", e));
  }
}
