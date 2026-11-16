import { NextResponse } from "next/server";
import { authenticateApiToken } from "@pm-collab/core/api-tokens";
import type { SessionUser } from "@pm-collab/core/auth";
import { TOOLS } from "@/mcp/tools";
import { callTool } from "@/mcp/dispatch";
import { passTest, recordClient, touchClient } from "@pm-collab/core/agent-connect/service";
import { TEST_TOOL } from "@pm-collab/core/shared/agent-clients";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * MCP 服务（Streamable HTTP，只用 JSON 响应）：POST /api/mcp，Authorization: Bearer <个人 API 令牌>。
 * 数据工具转调开放接口 v1，权限和数据范围与令牌所属的人完全一致；个人能力工具用这个人自己的模型。
 */
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const reply = (id: Rpc["id"], payload: { result?: unknown; error?: { code: number; message: string } }) => ({ jsonrpc: "2.0", id: id ?? null, ...payload });
const text = (data: unknown, isError = false) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : {}) });

async function handle(msg: Rpc, user: SessionUser, tokenId: string) {
  if (msg.method === "initialize") await recordClient(tokenId, msg.params?.clientInfo).catch(() => undefined);
  if (msg.method === "initialize") return reply(msg.id, { result: { protocolVersion: String(msg.params?.protocolVersion || "2025-06-18"), capabilities: { tools: {} }, serverInfo: { name: "weavi-space", version: "1.0.0" }, instructions: "小围空间（Weavi Space）项目协同系统：查询和修改需求、Bug、发版、产品、文档，以及运行个人能力。权限与令牌所属账号一致。" } });
  if (msg.method === "ping") return reply(msg.id, { result: {} });
  if (msg.method === "tools/list") return reply(msg.id, { result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (msg.method === "tools/call") {
    const name = String(msg.params?.name || "");
    const args = (msg.params?.arguments || {}) as Record<string, unknown>;
    await touchClient(tokenId).catch(() => undefined);
    if (name === TEST_TOOL) {
      const t = await passTest(tokenId, args.code, async () => {
        const r = await callTool(user, "list_projects", { pageSize: 1 });
        const total = (r?.data as { meta?: { total?: number } } | undefined)?.meta?.total ?? 0;
        return { ok: !!r?.ok, count: total };
      });
      return reply(msg.id, { result: text(t.message, !t.ok) });
    }
    const r = await callTool(user, name, args);
    if (!r) return reply(msg.id, { error: { code: -32602, message: `没有这个工具：${name}` } });
    return reply(msg.id, { result: text(r.data, !r.ok) });
  }
  if (msg.method?.startsWith("notifications/")) return null;
  return reply(msg.id, { error: { code: -32601, message: `不支持的方法：${msg.method}` } });
}

export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (!auth.ok) return NextResponse.json(reply(null, { error: { code: -32001, message: auth.status === 429 ? "请求过于频繁" : "令牌无效或已失效" } }), { status: auth.status });
  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json(reply(null, { error: { code: -32700, message: "JSON 解析失败" } }), { status: 400 });
  const user = auth.principal.user;
  const batch = Array.isArray(raw) ? (raw as Rpc[]).slice(0, 20) : [raw as Rpc];
  const out = (await Promise.all(batch.map((m) => handle(m, user, auth.principal.tokenId)))).filter(Boolean);
  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(raw) ? out : out[0]);
}

export async function GET() {
  return NextResponse.json({ error: "请用 POST（MCP Streamable HTTP，JSON 响应）" }, { status: 405 });
}
