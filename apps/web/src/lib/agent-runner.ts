import { registerAgentDeps, resumeAfterRestart, toolLevel, type AgentTool } from "@pm-collab/core/agent/loop";
import { TOOLS } from "@/mcp/tools";
import { callTool } from "@/mcp/dispatch";
import { prisma } from "./prisma";
import { botEvents, buildCard, deliver, siteUrl } from "./feishu-bot";

/**
 * 系统内 Agent 的工具清单：直接用 MCP 的工具注册表（一处加工具，内部 Agent 和外部 Claude Code 都能用）。
 * 「在我的电脑执行」测试用的 delivery_* 工具和连通测试工具只给本机 Agent，不给系统内 Agent。
 */
const LABEL: Record<string, string> = {
  list_projects: "查看项目列表",
  list_requirements: "查询需求",
  get_requirement: "读取需求详情",
  create_requirement: "新建需求",
  update_requirement: "修改需求",
  update_requirement_status: "修改需求状态",
  comment_requirement: "评论需求",
  list_bugs: "查询 Bug",
  get_bug: "读取 Bug 详情",
  create_bug: "新建 Bug",
  update_bug_status: "修改 Bug 状态",
  list_releases: "查询发版",
  list_products: "查询产品",
  list_doc_spaces: "查看文档空间",
  get_doc_page: "读取文档",
  get_skill_file: "读取内置能力说明",
  list_skills: "查看个人能力",
  run_skill: "执行个人能力",
};

export const AGENT_TOOLS: AgentTool[] = TOOLS.filter((t) => !t.name.startsWith("delivery_") && t.name !== "weavi_connection_test").map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.inputSchema,
  level: toolLevel(t.name),
  label: LABEL[t.name] || t.name,
}));

export function toolLabel(name: string) {
  return LABEL[name] || name;
}

const plain = (v: unknown) => String(typeof v === "string" ? v : JSON.stringify(v)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** 等确认的那一步写成一两行字（站内通知和飞书卡片用）；不带 id 之类的内部字段 */
function pendingText(args: Record<string, unknown>) {
  const pick = ["title", "status", "severity", "priority", "bodyHtml", "descriptionHtml", "input"];
  return pick
    .filter((k) => args[k] !== undefined && args[k] !== null && args[k] !== "")
    .map((k) => plain(args[k]).slice(0, 120))
    .join(" · ");
}

/**
 * 自动化规则触发的任务要确认时：站内通知 + 按订阅发飞书卡片（按钮打开任务详情页确认）。
 * 对话里发起的任务用户就在页面上，不另外提醒。
 */
async function notifyWaiting(taskId: string) {
  const t = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { userId: true, source: true, pending: true, goal: true, rule: { select: { name: true } } } });
  if (!t || t.source !== "rule") return;
  const call = (t.pending as { calls?: { name: string; args: Record<string, unknown> }[] } | null)?.calls?.[0];
  if (!call) return;
  const href = `/ai/tasks/${taskId}`;
  const title = `小围等你确认：${toolLabel(call.name)}`;
  const detail = pendingText(call.args || {});
  const ruleName = t.rule?.name || t.goal;
  await prisma.notification.create({ data: { userId: t.userId, kind: "agent_confirm", title: title.slice(0, 200), body: `规则「${ruleName}」${detail ? `：${detail}` : ""}`.slice(0, 500), href, entityType: "agent_task", entityId: taskId } });
  const bot = await prisma.userBot.findUnique({ where: { userId: t.userId } });
  if (!bot || !(bot.webhookOn || bot.dmOn) || !botEvents(bot.events).includes("agent_confirm")) return;
  const card = buildCard({ title, lines: [`规则「${ruleName}」`, detail ? `小围想${toolLabel(call.name)}：${detail}` : "", "确认之前小围不会执行，也不消耗 token。"].filter(Boolean), url: siteUrl(href), button: "去确认", tone: "orange" });
  await deliver(t.userId, card);
}

/** 自动化规则触发的任务结束时发一条站内通知（失败、熔断也告诉创建人） */
async function notifyFinished(taskId: string) {
  const t = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { userId: true, source: true, status: true, error: true, goal: true, steps: true, rule: { select: { name: true } } } });
  if (!t || t.source !== "rule") return;
  const name = t.rule?.name || t.goal;
  const title = t.status === "done" ? `自动化「${name}」已完成` : t.status === "cancelled" ? `自动化「${name}」已停止` : `自动化「${name}」没有做完`;
  await prisma.notification.create({ data: { userId: t.userId, kind: "agent_done", title: title.slice(0, 200), body: (t.status === "done" ? `共 ${t.steps} 步` : t.error || "").slice(0, 500) || null, href: `/ai/tasks/${taskId}`, entityType: "agent_task", entityId: taskId } });
}

let registered = false;
export function ensureAgent() {
  if (registered) return;
  registered = true;
  registerAgentDeps({
    tools: AGENT_TOOLS,
    exec: async (user, name, args) => (await callTool(user, name, args)) ?? { ok: false, data: { error: `没有这个工具：${name}` } },
    onWaiting: notifyWaiting,
    onFinished: notifyFinished,
  });
}

/** 启动时：注册并恢复重启前中断的任务 */
export async function startAgent() {
  ensureAgent();
  await resumeAfterRestart();
}
