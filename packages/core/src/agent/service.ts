import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { canSeeProject } from "../access";
import { result } from "../nova/result";
import { credentialForUse } from "../ai/credentials";
import type { AgentMsg } from "../ai/providers";
import { cancelTask, enqueue, resolvePending } from "./loop";
import { budgetFor } from "./budget";
import { myEnterprise } from "../ai/credentials";

/** 小围对话「动手模式」的接口（T27）：发起任务、查看进度、确认 / 不同意、停止 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function taskView(t: {
  id: string; status: string; goal: string; model: string; steps: number; maxSteps: number; maxTokens: number; inputTokens: number; outputTokens: number; result: string | null; error: string | null; pending: unknown; createdAt: Date; updatedAt: Date; finishedAt: Date | null;
  source?: string; hops?: number; trigger?: unknown; conversationId?: string | null; rule?: { id: string; name: string } | null;
  stepRows?: { id: string; seq: number; kind: string; tool: string | null; level: string | null; args: unknown; summary: string; status: string; createdAt: Date }[];
}) {
  const calls = (t.pending as { calls?: { name: string; args: Record<string, unknown> }[] } | null)?.calls || [];
  return {
    id: t.id,
    status: t.status,
    goal: t.goal,
    model: t.model,
    steps: t.steps,
    maxSteps: t.maxSteps,
    tokens: t.inputTokens + t.outputTokens,
    maxTokens: t.maxTokens,
    source: t.source || "chat",
    hops: t.hops || 0,
    trigger: triggerSummary(t.trigger),
    conversationId: t.conversationId ?? null,
    rule: t.rule ? { id: t.rule.id, name: t.rule.name } : null,
    result: t.result,
    error: t.error,
    pending: calls[0] ? { name: calls[0].name, args: calls[0].args } : null,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
    finishedAt: iso(t.finishedAt),
    stepRows: (t.stepRows || []).map((s) => ({ id: s.id, seq: s.seq, kind: s.kind, tool: s.tool, level: s.level, args: s.args, summary: s.summary, status: s.status, createdAt: iso(s.createdAt) })),
  };
}

/** 触发事件给界面看的一行字（trigger.text 的第一行之后是给模型的资料） */
function triggerSummary(v: unknown): string | null {
  const t = v as { label?: unknown } | null;
  return t && typeof t.label === "string" ? t.label : null;
}

const withSteps = { stepRows: { orderBy: { seq: "asc" as const } }, rule: { select: { id: true, name: true } } };

/** 发起：{ conversationId?, message, scope, projectId?, credentialId, model } */
export async function startTask(session: SessionUser, body: Record<string, unknown>) {
  if (session.isDemo) return result({ error: "体验账号不能使用动手模式" }, { status: 403 });
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!message) return result({ error: "请输入内容" }, { status: 400 });
  const scope = String(body.scope) === "project" ? "project" : String(body.scope) === "local" ? "local" : "workspace";
  if (scope === "local") return result({ error: "动手模式不能读本地文件夹，请把范围换成项目或全部项目" }, { status: 400 });
  const projectId = scope === "project" ? String(body.projectId || "") : null;
  if (scope === "project" && (!projectId || !(await canSeeProject(session, projectId)))) return result({ error: "项目不存在" }, { status: 404 });
  const credentialId = String(body.credentialId || "");
  const model = String(body.model || "");
  if (!credentialId || !model) return result({ error: "请先选择模型（设置 · 个人 · 模型管理）" }, { status: 400 });
  const use = await credentialForUse(session, credentialId, model);
  if ("error" in use) return result({ error: use.error }, { status: 402 });
  const budget = await budgetFor(await myEnterprise(session));
  const busy = await prisma.agentTask.count({ where: { userId: session.id, status: { in: ["queued", "running", "waiting"] } } });
  if (busy >= budget.maxActive) return result({ error: `你已经有 ${busy} 个任务在进行中（上限 ${budget.maxActive} 个），先等它们做完或停止一个` }, { status: 429 });

  let conv = body.conversationId ? await prisma.aiConversation.findFirst({ where: { id: String(body.conversationId), userId: session.id } }) : null;
  if (body.conversationId && !conv) return result({ error: "对话不存在" }, { status: 404 });
  if (!conv) conv = await prisma.aiConversation.create({ data: { userId: session.id, title: message.slice(0, 30), scope, projectId, credentialId, model } });
  else conv = await prisma.aiConversation.update({ where: { id: conv.id }, data: { scope, projectId, credentialId, model } });

  // 这段对话之前的内容作为背景（只取文字，最近 10 条）
  const history = await prisma.aiMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, take: 10 });
  const transcript: AgentMsg[] = history.reverse().filter((m) => m.content).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }) as AgentMsg);
  transcript.push({ role: "user", content: message });

  const userMsg = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: "user", content: message } });
  const task = await prisma.agentTask.create({ data: { userId: session.id, conversationId: conv.id, goal: message, scope, projectId, credentialId, model, maxSteps: budget.maxSteps, maxTokens: budget.maxTokens, transcript: transcript as unknown as object[] } });
  const reply = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: "assistant", content: "", agentTaskId: task.id } });
  await enqueue(task.id);
  const fresh = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id }, include: withSteps });
  return result({
    conversationId: conv.id,
    userMessage: { ...userMsg, createdAt: userMsg.createdAt.toISOString() },
    message: { ...reply, createdAt: reply.createdAt.toISOString() },
    task: taskView(fresh),
  });
}

export async function getTask(session: SessionUser, id: string) {
  const t = await prisma.agentTask.findFirst({ where: { id, userId: session.id }, include: withSteps });
  if (!t) return result({ error: "任务不存在" }, { status: 404 });
  return result({ task: taskView(t) });
}

/** 一段对话里的所有任务（打开历史对话时用） */
export async function tasksOfConversation(session: SessionUser, conversationId: string) {
  const rows = await prisma.agentTask.findMany({ where: { conversationId, userId: session.id }, include: withSteps, orderBy: { createdAt: "asc" } });
  return rows.map(taskView);
}

/** { approve: boolean, note?: string } */
export async function resolveTask(session: SessionUser, id: string, body: Record<string, unknown>) {
  const t = await prisma.agentTask.findFirst({ where: { id, userId: session.id }, select: { status: true } });
  if (!t) return result({ error: "任务不存在" }, { status: 404 });
  if (t.status !== "waiting") return result({ error: "这一步已经处理过了" }, { status: 409 });
  const ok = await resolvePending(id, session, body.approve === true, String(body.note || "").trim());
  if (!ok) return result({ error: "这一步已经处理过了" }, { status: 409 });
  return getTask(session, id);
}

export async function stopTask(session: SessionUser, id: string) {
  const ok = await cancelTask(id, session.id);
  if (!ok) return result({ error: "任务已经结束" }, { status: 409 });
  return getTask(session, id);
}

/** AI · 任务页：我的任务（对话发起 + 规则触发），按状态 / 来源筛选，分页 */
export const TASK_FILTERS = ["waiting", "active", "done", "stopped", "all"] as const;
export async function listTasks(session: SessionUser, q: { status?: string | null; source?: string | null; page?: number }) {
  const status = (TASK_FILTERS as readonly string[]).includes(String(q.status)) ? String(q.status) : "all";
  const statusWhere =
    status === "waiting" ? { status: "waiting" } : status === "active" ? { status: { in: ["queued", "running"] } } : status === "done" ? { status: "done" } : status === "stopped" ? { status: { in: ["failed", "cancelled"] } } : {};
  const sourceWhere = q.source === "chat" || q.source === "rule" ? { source: q.source } : {};
  const where = { userId: session.id, ...statusWhere, ...sourceWhere };
  const size = 20;
  const page = Math.max(1, Math.floor(q.page || 1));
  const [rows, total, counts] = await Promise.all([
    prisma.agentTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      select: { id: true, status: true, goal: true, model: true, steps: true, maxSteps: true, inputTokens: true, outputTokens: true, source: true, trigger: true, error: true, createdAt: true, finishedAt: true, conversationId: true, pending: true, rule: { select: { id: true, name: true, triggerType: true, event: true, freq: true, time: true } } },
    }),
    prisma.agentTask.count({ where }),
    prisma.agentTask.groupBy({ by: ["status"], where: { userId: session.id }, _count: { _all: true } }),
  ]);
  const n = (ss: string[]) => counts.filter((c) => ss.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
  // 最近一步（列表第二行显示）
  const lastSteps = rows.length
    ? await prisma.agentStep.findMany({ where: { taskId: { in: rows.map((r) => r.id) } }, orderBy: { seq: "desc" }, distinct: ["taskId"], select: { taskId: true, summary: true } })
    : [];
  return result({
    status,
    page,
    size,
    total,
    counts: { waiting: n(["waiting"]), active: n(["queued", "running"]), done: n(["done"]), stopped: n(["failed", "cancelled"]) },
    tasks: rows.map((r) => ({
      id: r.id,
      status: r.status,
      goal: r.goal,
      model: r.model,
      steps: r.steps,
      maxSteps: r.maxSteps,
      tokens: r.inputTokens + r.outputTokens,
      source: r.source,
      rule: r.rule,
      trigger: triggerSummary(r.trigger),
      conversationId: r.conversationId,
      error: r.error,
      lastStep: lastSteps.find((x) => x.taskId === r.id)?.summary || null,
      createdAt: iso(r.createdAt),
      finishedAt: iso(r.finishedAt),
    })),
  });
}

/** 侧栏「任务」后面的数字：等我确认的任务数 */
export async function waitingCount(session: SessionUser) {
  return prisma.agentTask.count({ where: { userId: session.id, status: "waiting" } });
}
