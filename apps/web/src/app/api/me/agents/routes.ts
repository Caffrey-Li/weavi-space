import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "@/lib/auth";
import * as svc from "@pm-collab/core/agent-connect/service";
import { TOOLS } from "@/mcp/tools";

/** 设置 · 本机 Agent（T28）的接口：登录在这里校验，归属在服务层校验 */
type Res = { body: unknown; init?: { status: number } };
type Ctx = { params: Promise<{ id: string }> };
const json = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;
async function run(fn: (s: SessionUser) => Promise<Res>) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await fn(s);
  return NextResponse.json(r.body, r.init);
}
const toolCount = TOOLS.filter((t) => t.name !== "weavi_connection_test").length;

export const list = {
  GET: () => run((s) => svc.listConnections(s)),
  POST: async (req: Request) => { const b = await json(req); return run((s) => svc.createConnection(s, b)); },
};
export const byId = {
  GET: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => svc.getConnection(s, id)); },
  PATCH: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => svc.updateConnection(s, id, b)); },
  DELETE: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => svc.deleteConnection(s, id)); },
};
export const test = { POST: async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return run((s) => svc.startTest(s, id, toolCount)); } };
export const token = { POST: async (req: Request, ctx: Ctx) => { const b = await json(req); const { id } = await ctx.params; return run((s) => svc.rotateToken(s, id, b)); } };
