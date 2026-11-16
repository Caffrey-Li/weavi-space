import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "@/lib/auth";
import * as creds from "@pm-collab/core/ai/credentials";
import * as chat from "@pm-collab/core/ai/chat";
import * as agent from "@pm-collab/core/agent/service";
import * as rules from "@pm-collab/core/agent/rules";
import * as budget from "@pm-collab/core/agent/budget";
import { ensureAgent } from "@/lib/agent-runner";

type Res = { body: unknown; init?: { status: number } };
type Ctx = { params: Promise<{ id: string }> };
const json = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;
async function run(fn: (s: SessionUser) => Promise<Res>) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await fn(s);
  return NextResponse.json(r.body, r.init);
}

/** AI 相关接口：登录在这里校验，归属、企业超管身份、额度在服务层校验 */
export const models = { GET: () => run(async (s) => ({ body: await creds.availableModels(s) })) };
export const credentials = {
  GET: (req: Request) => run((s) => creds.settingsGET(s, new URL(req.url).searchParams.get("enterprise"))),
  POST: async (req: Request) => { const b = await json(req); return run((s) => creds.createCredential(s, b)); },
};
export const credentialById = {
  PATCH: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => creds.updateCredential(s, id, b)); },
  DELETE: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => creds.deleteCredential(s, id)); },
};
export const credentialTest = {
  POST: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => creds.testCredential(s, id, b)); },
};
export const quotas = { PUT: async (req: Request) => { const b = await json(req); return run((s) => creds.setQuota(s, b)); } };
export const conversations = {
  GET: () => run((s) => chat.listConversations(s)),
  POST: async (req: Request) => { const b = await json(req); return run((s) => chat.sendMessage(s, b)); },
};
export const conversationById = {
  GET: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => chat.getConversation(s, id)); },
  DELETE: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => chat.deleteConversation(s, id)); },
};
export const actionById = {
  POST: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => chat.resolveAction(s, id, b.confirm === true)); },
};

/** 动手模式（系统内 Agent） */
export const agentStart = {
  POST: async (req: Request) => { ensureAgent(); const b = await json(req); return run((s) => agent.startTask(s, b)); },
};
export const agentTaskById = {
  GET: async (_req: Request, ctx: Ctx) => { ensureAgent(); const { id } = await ctx.params; return run((s) => agent.getTask(s, id)); },
};
export const agentTaskResolve = {
  POST: async (req: Request, ctx: Ctx) => { ensureAgent(); const b = await json(req); const { id } = await ctx.params; return run((s) => agent.resolveTask(s, id, b)); },
};
export const agentTaskStop = {
  POST: async (_req: Request, ctx: Ctx) => { ensureAgent(); const { id } = await ctx.params; return run((s) => agent.stopTask(s, id)); },
};

/** AI · 任务页、自动化规则、预算（T27 二期） */
export const agentTasks = {
  GET: (req: Request) =>
    run((s) => {
      const sp = new URL(req.url).searchParams;
      return agent.listTasks(s, { status: sp.get("status"), source: sp.get("source"), page: Number(sp.get("page") || 1) });
    }),
};
export const agentWaiting = { GET: () => run(async (s) => ({ body: { waiting: await agent.waitingCount(s) } })) };
export const agentRules = {
  GET: () => run((s) => rules.listRules(s)),
  POST: async (req: Request) => { const b = await json(req); return run((s) => rules.createRule(s, b)); },
};
export const agentRuleById = {
  PATCH: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => rules.updateRule(s, id, b)); },
  DELETE: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => rules.deleteRule(s, id)); },
};
export const agentBudget = {
  GET: (req: Request) => run((s) => budget.budgetGET(s, new URL(req.url).searchParams.get("enterprise"))),
  PUT: async (req: Request) => { const b = await json(req); return run((s) => budget.budgetPUT(s, b)); },
};
