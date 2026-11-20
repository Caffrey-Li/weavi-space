import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import type { Prisma } from "@prisma/client";
import { bugWhere, canSeeProject, getAccess, projectWhere, requirementWhere } from "../access";
import { BUG_STATUS, REQ_STATUS } from "../shared/constants";
import { result } from "../nova/result";
import { chatOnce } from "./providers";
import { credentialForUse } from "./credentials";
import { recordUsage } from "./quota";
import { tasksOfConversation } from "../agent/service";
import { POST as createRequirement } from "../requirements/root";
import { POST as createBug } from "../bugs/index";
import { PATCH as patchRequirementStatus } from "../requirements/id-status";
import { PATCH as patchBugStatus } from "../bugs/id-status";

/**
 * AI 对话：范围 none（不关联数据）/ workspace（我能看到的所有进行中项目）/ project（某个项目）/ local（用户选的本地文件夹）。
 * 数据只取当前用户的数据范围。AI 想新建或修改数据时，回复里带一个 action，前端展示给用户，确认后才执行，
 * 执行走正常的业务接口（权限、校验、动态都照旧）。
 */
const ACTION_KINDS = ["create_requirement", "create_bug", "update_requirement_status", "update_bug_status"] as const;
type Action = { type: (typeof ACTION_KINDS)[number]; [k: string]: unknown };

/** 本地文件夹（用户在浏览器里选的，前端读好文本随提问发来，服务端不落盘）：限制条数和总字数 */
const LOCAL_MAX_CHARS = 80_000;
export function localContext(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as { name?: unknown; tree?: unknown; files?: unknown };
  const name = String(r.name || "本地文件夹").slice(0, 120);
  const tree = Array.isArray(r.tree) ? r.tree.slice(0, 600).map((x) => String(x).slice(0, 300)) : [];
  const files = Array.isArray(r.files) ? r.files.slice(0, 200) : [];
  let budget = LOCAL_MAX_CHARS;
  const parts: string[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object" || budget <= 0) break;
    const path = String((f as { path?: unknown }).path || "").slice(0, 300);
    const content = String((f as { content?: unknown }).content || "").slice(0, budget);
    if (!path) continue;
    budget -= content.length;
    parts.push(`--- ${path} ---\n${content}`);
  }
  return [
    `本地文件夹「${name}」（用户在自己电脑上选择的，只读；你不能修改这些文件）`,
    `文件列表（${tree.length} 个）：\n${tree.join("\n") || "无"}`,
    parts.length ? `文件内容（节选）：\n${parts.join("\n\n")}` : "（没有读到文本文件内容）",
  ].join("\n\n");
}

async function buildContext(session: SessionUser, scope: string, projectId: string | null, local?: unknown, question = "") {
  if (scope === "none") return "";
  if (scope === "local") return localContext(local) || "（这段对话关联的是本地文件夹，但这次没有带上文件内容，请提醒用户在范围里重新选择文件夹。）";
  const access = await getAccess(session);
  const projects = await prisma.project.findMany({
    where: { ...(scope === "project" && projectId ? { id: projectId } : { status: "active" }), AND: [projectWhere(access)] },
    select: { id: true, name: true, key: true },
    take: 50,
  });
  const ids = projects.length ? projects.map((p) => p.id) : ["__none__"];
  const [reqs, bugs] = await Promise.all([
    prisma.requirement.findMany({ where: { archivedAt: null, status: { not: "cancelled" }, projectId: { in: ids }, AND: [requirementWhere(access)] }, select: { id: true, title: true, status: true, priority: true, projectId: true, plannedEndAt: true }, orderBy: { updatedAt: "desc" }, take: 300 }),
    prisma.bug.findMany({ where: { archivedAt: null, status: { notIn: ["closed", "cancelled"] }, projectId: { in: ids }, AND: [bugWhere(access)] }, select: { id: true, title: true, status: true, severity: true, projectId: true }, orderBy: { updatedAt: "desc" }, take: 150 }),
  ]);
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const rl = (k: string) => REQ_STATUS.find((s) => s.key === k)?.label || k;
  const bl = (k: string) => BUG_STATUS.find((s) => s.key === k)?.label || k;
  // T36 知识库：按这次的问题从能看到的文档里找最相关的几篇，带上开头一段（全文由用户点开看）
  const { relatedDocs } = await import("../docs/search");
  const docs = question ? await relatedDocs(session, question, { projectId: scope === "project" ? projectId : null }).catch(() => []) : [];
  return [
    ...(docs.length ? [`相关文档（按问题检索，id｜标题｜开头内容；引用时写出文档标题）：\n${docs.map((d) => `${d.id}｜${d.title}｜${d.excerpt}`).join("\n\n")}`] : []),
    `项目（id｜名称）：\n${projects.map((p) => `${p.id}｜${p.name}`).join("\n") || "无"}`,
    `需求（id｜项目｜标题｜状态｜优先级｜计划完成）：\n${reqs.map((r) => `${r.id}｜${pname.get(r.projectId || "") || "公共池"}｜${r.title}｜${rl(r.status)}｜${r.priority}｜${r.plannedEndAt ? r.plannedEndAt.toISOString().slice(0, 10) : "-"}`).join("\n") || "无"}`,
    `未关闭 Bug（id｜项目｜标题｜状态｜严重级别）：\n${bugs.map((b) => `${b.id}｜${pname.get(b.projectId || "") || "-"}｜${b.title}｜${bl(b.status)}｜${b.severity}`).join("\n") || "无"}`,
  ].join("\n\n");
}

/** 回答格式：页面按 Markdown 渲染（版式参照 ChatGPT），对话和动手模式共用 */
export const FORMAT_RULES =
  "回答格式：用 Markdown。先用一两句话直接给结论；内容多时用 ### 小标题分段；并列的几项用列表；多条记录对比（需求、Bug、负责人、日期等）用表格；关键数字和结论可以加粗；代码、命令、字段名放在代码块或行内代码里。不要用 HTML，不要为了格式而格式，简单问题直接一段话回答。";

/** 今天的日期（服务器本机时间），判断逾期、本周等要用 */
export function todayLine(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `今天是 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}（星期${week}），现在 ${pad(now.getHours())}:${pad(now.getMinutes())}（服务器时间）。判断逾期：计划完成早于今天且状态不是已上线 / 已取消。`;
}

function systemPrompt(context: string) {
  return [
    "你是「小围空间」（中文项目协同系统）里的 AI 助手「小围」，用简洁的中文回答。只根据下面提供的数据回答数据问题，不知道就说不知道，不要编造。",
    todayLine(),
    FORMAT_RULES,
    "如果用户要求新建或修改数据，先用一句话说明你要做什么，然后在回复最后输出一个 ```action 代码块，里面是一个 JSON 对象，系统会请用户确认后再执行。只支持：",
    '{"type":"create_requirement","projectId":"<项目 id>","title":"标题","priority":"p0|p1|p2|p3"}',
    '{"type":"create_bug","projectId":"<项目 id>","title":"标题","severity":"blocker|critical|major|minor|trivial"}',
    `{"type":"update_requirement_status","id":"<需求 id>","status":"${REQ_STATUS.map((s) => s.key).join("|")}"}`,
    `{"type":"update_bug_status","id":"<Bug id>","status":"${BUG_STATUS.map((s) => s.key).join("|")}"}`,
    "一次最多一个 action；id 只能用下面数据里出现过的。",
    context ? `\n=== 数据（当前用户能看到的） ===\n${context}` : "\n（这次对话不关联系统数据。）",
  ].join("\n");
}

export function parseAction(text: string): { clean: string; action: Action | null } {
  const m = text.match(/```action\s*([\s\S]*?)```/);
  if (!m) return { clean: text.trim(), action: null };
  try {
    const a = JSON.parse(m[1].trim()) as Action;
    if (!(ACTION_KINDS as readonly string[]).includes(a.type)) return { clean: text.replace(m[0], "").trim(), action: null };
    return { clean: text.replace(m[0], "").trim(), action: a };
  } catch {
    return { clean: text.replace(m[0], "").trim(), action: null };
  }
}

export async function listConversations(session: SessionUser) {
  const rows = await prisma.aiConversation.findMany({ where: { userId: session.id }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, scope: true, projectId: true, credentialId: true, model: true, updatedAt: true } });
  return result({ conversations: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
}

export async function getConversation(session: SessionUser, id: string) {
  const c = await prisma.aiConversation.findFirst({ where: { id, userId: session.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!c) return result({ error: "对话不存在" }, { status: 404 });
  const tasks = c.messages.some((m) => m.agentTaskId) ? await tasksOfConversation(session, c.id) : [];
  return result({ conversation: { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(), messages: c.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) }, tasks });
}

export async function deleteConversation(session: SessionUser, id: string) {
  const r = await prisma.aiConversation.deleteMany({ where: { id, userId: session.id } });
  return r.count ? result({ ok: true }) : result({ error: "对话不存在" }, { status: 404 });
}

/** 发一条消息：{ conversationId?, message, scope, projectId?, credentialId, model } */
export async function sendMessage(session: SessionUser, body: Record<string, unknown>) {
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!message) return result({ error: "请输入内容" }, { status: 400 });
  const scope = ["none", "workspace", "project", "local"].includes(String(body.scope)) ? String(body.scope) : "none";
  const projectId = scope === "project" ? String(body.projectId || "") : null;
  if (scope === "project" && (!projectId || !(await canSeeProject(session, projectId)))) return result({ error: "项目不存在" }, { status: 404 });
  const credentialId = String(body.credentialId || "");
  const model = String(body.model || "");
  if (!credentialId || !model) return result({ error: "请先选择模型（设置 · 个人 · 模型管理）" }, { status: 400 });
  const use = await credentialForUse(session, credentialId, model);
  if ("error" in use) return result({ error: use.error }, { status: 402 });

  let conv = body.conversationId ? await prisma.aiConversation.findFirst({ where: { id: String(body.conversationId), userId: session.id } }) : null;
  if (body.conversationId && !conv) return result({ error: "对话不存在" }, { status: 404 });
  if (!conv) conv = await prisma.aiConversation.create({ data: { userId: session.id, title: message.slice(0, 30), scope, projectId, credentialId, model } });
  else conv = await prisma.aiConversation.update({ where: { id: conv.id }, data: { scope, projectId, credentialId, model } });

  const history = await prisma.aiMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, take: 20 });
  await prisma.aiMessage.create({ data: { conversationId: conv.id, role: "user", content: message } });
  const msgs = [...history.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user" as const, content: message }];
  let out;
  try {
    out = await chatOnce(use.cred, model, systemPrompt(await buildContext(session, scope, projectId, body.localFiles, message)), msgs);
  } catch (e) {
    return result({ error: `模型调用失败：${(e as Error).message}`, conversationId: conv.id }, { status: 502 });
  }
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "chat", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  const { clean, action } = parseAction(out.text);
  const saved = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: "assistant", content: clean || "（没有回复内容）", action: action ? (action as unknown as Prisma.InputJsonObject) : undefined, actionStatus: action ? "pending" : null } });
  await prisma.aiConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  return result({ conversationId: conv.id, message: { ...saved, createdAt: saved.createdAt.toISOString() }, usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens } });
}

/** 确认或取消 AI 提议的操作；执行用当前用户的权限 */
export async function resolveAction(session: SessionUser, messageId: string, confirm: boolean) {
  const m = await prisma.aiMessage.findFirst({ where: { id: messageId, conversation: { userId: session.id } } });
  if (!m || !m.action) return result({ error: "操作不存在" }, { status: 404 });
  if (m.actionStatus !== "pending") return result({ error: "这个操作已经处理过了" }, { status: 409 });
  // 先占住，防止重复确认
  const lock = await prisma.aiMessage.updateMany({ where: { id: m.id, actionStatus: "pending" }, data: { actionStatus: confirm ? "running" : "cancelled" } });
  if (!lock.count) return result({ error: "这个操作已经处理过了" }, { status: 409 });
  if (!confirm) return result({ ok: true, status: "cancelled" });
  const a = m.action as Action;
  let r: { body: unknown; init?: { status: number } };
  if (a.type === "create_requirement") r = await createRequirement(session, { title: a.title, projectId: a.projectId, priority: a.priority });
  else if (a.type === "create_bug") r = await createBug(session, { title: a.title, projectId: a.projectId, severity: a.severity });
  else if (a.type === "update_requirement_status") r = await patchRequirementStatus(session, { id: String(a.id || "") }, { status: a.status });
  else r = await patchBugStatus(session, { id: String(a.id || "") }, { status: a.status });
  const ok = !r.init || r.init.status < 400;
  const msg = ok ? "已执行" : String((r.body as { error?: string })?.error || "执行失败");
  await prisma.aiMessage.update({ where: { id: m.id }, data: { actionStatus: ok ? "done" : "failed", actionResult: msg } });
  return result({ ok, status: ok ? "done" : "failed", message: msg, data: ok ? r.body : undefined }, ok ? undefined : { status: r.init!.status });
}
