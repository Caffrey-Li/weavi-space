import { randomInt } from "node:crypto";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { createApiToken, revokeApiToken } from "../api-tokens";
import { API_SCOPES, isApiScope } from "../api-tokens/scopes";
import { CONN_STATE_LABEL, connState, normalizeBaseUrl, presetOf, testPrompt } from "../shared/agent-clients";

/**
 * 本机 Agent 接入（T28）：每个 Agent 一条连接 + 一张专用令牌（明文只在创建 / 换令牌时返回一次）。
 * 连通测试分两步：服务端检查令牌和权限；再生成一次性测试码，Agent 用这张令牌调 weavi_connection_test 并带上测试码才算连通。
 */
const TEST_MINUTES = 15;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_CONNECTIONS = 20;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const tokenOk = (t: { revokedAt: Date | null; expiresAt: Date | null }) => !t.revokedAt && (!t.expiresAt || t.expiresAt.getTime() > Date.now());

type Row = Awaited<ReturnType<typeof loadRows>>[number];
function loadRows(userId: string, id?: string) {
  return prisma.agentConnection.findMany({
    where: { userId, ...(id ? { id } : {}) },
    include: { token: { select: { id: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export function connectionView(c: Row) {
  const ok = tokenOk(c.token);
  const state = connState(c, ok);
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    kindLabel: presetOf(c.kind)?.label || c.kind,
    baseUrl: c.baseUrl,
    state,
    stateLabel: CONN_STATE_LABEL[state],
    clientName: c.clientName,
    clientVersion: c.clientVersion,
    verifiedAt: iso(c.verifiedAt),
    lastSeenAt: iso(c.lastSeenAt || c.token.lastUsedAt),
    lastTestAt: iso(c.lastTestAt),
    testDetail: c.testDetail,
    testPrompt: state === "testing" && c.testCode ? testPrompt(c.testCode) : null,
    testExpiresAt: state === "testing" ? iso(c.testExpiresAt) : null,
    scopes: c.token.scopes,
    tokenExpiresAt: iso(c.token.expiresAt),
    createdAt: iso(c.createdAt),
  };
}

function readInput(body: Record<string, unknown>) {
  const name = String(body.name || "").trim().slice(0, 60);
  const kind = String(body.kind || "");
  const baseUrl = normalizeBaseUrl(String(body.baseUrl || ""));
  const scopes = Array.isArray(body.scopes) ? body.scopes.map(String).filter(isApiScope) : [];
  const days = Math.min(365, Math.max(1, Number(body.days) || 90));
  if (!presetOf(kind)) return { error: "请选择 Agent" } as const;
  if (!name) return { error: "请填写名称" } as const;
  if (!baseUrl) return { error: "系统地址要以 http:// 或 https:// 开头" } as const;
  if (!scopes.length) return { error: "至少选一项权限" } as const;
  return { name, kind, baseUrl, scopes, days };
}

export async function listConnections(session: SessionUser) {
  const rows = await loadRows(session.id);
  return result({ connections: rows.map(connectionView), scopes: API_SCOPES });
}

/** 新建：同时签发专用令牌，返回明文令牌（只这一次） */
export async function createConnection(session: SessionUser, body: Record<string, unknown>) {
  const input = readInput(body);
  if ("error" in input) return result({ error: input.error }, { status: 400 });
  if ((await prisma.agentConnection.count({ where: { userId: session.id } })) >= MAX_CONNECTIONS) return result({ error: `最多接入 ${MAX_CONNECTIONS} 个 Agent` }, { status: 400 });
  let t;
  try {
    t = await createApiToken(session, { name: `本机 Agent · ${input.name}`.slice(0, 80), scopes: input.scopes, expiresAt: new Date(Date.now() + input.days * 864e5) });
  } catch (e) {
    return result({ error: (e as Error).message || "创建令牌失败" }, { status: 400 });
  }
  const c = await prisma.agentConnection.create({ data: { userId: session.id, name: input.name, kind: input.kind, baseUrl: input.baseUrl, tokenId: t.id } });
  const [row] = await loadRows(session.id, c.id);
  return result({ connection: connectionView(row), token: t.token });
}

/** 改名称 / Agent / 地址（不动令牌） */
export async function updateConnection(session: SessionUser, id: string, body: Record<string, unknown>) {
  const c = await prisma.agentConnection.findFirst({ where: { id, userId: session.id } });
  if (!c) return result({ error: "连接不存在" }, { status: 404 });
  const data: { name?: string; kind?: string; baseUrl?: string } = {};
  if (body.name !== undefined) data.name = String(body.name).trim().slice(0, 60) || c.name;
  if (body.kind !== undefined) {
    if (!presetOf(String(body.kind))) return result({ error: "请选择 Agent" }, { status: 400 });
    data.kind = String(body.kind);
  }
  if (body.baseUrl !== undefined) {
    const u = normalizeBaseUrl(String(body.baseUrl));
    if (!u) return result({ error: "系统地址要以 http:// 或 https:// 开头" }, { status: 400 });
    data.baseUrl = u;
  }
  await prisma.agentConnection.update({ where: { id }, data });
  const [row] = await loadRows(session.id, id);
  return result({ connection: connectionView(row) });
}

/** 换令牌（令牌丢了、过期了或要改权限）：签新的、吊销旧的，连通状态清空需要重新测试 */
export async function rotateToken(session: SessionUser, id: string, body: Record<string, unknown>) {
  const c = await prisma.agentConnection.findFirst({ where: { id, userId: session.id }, include: { token: true } });
  if (!c) return result({ error: "连接不存在" }, { status: 404 });
  const scopes = Array.isArray(body.scopes) ? body.scopes.map(String).filter(isApiScope) : c.token.scopes.filter(isApiScope);
  if (!scopes.length) return result({ error: "至少选一项权限" }, { status: 400 });
  const days = Math.min(365, Math.max(1, Number(body.days) || 90));
  let t;
  try {
    t = await createApiToken(session, { name: `本机 Agent · ${c.name}`.slice(0, 80), scopes, expiresAt: new Date(Date.now() + days * 864e5) });
  } catch (e) {
    return result({ error: (e as Error).message || "创建令牌失败" }, { status: 400 });
  }
  await prisma.agentConnection.update({ where: { id }, data: { tokenId: t.id, verifiedAt: null, lastTestAt: null, testCode: null, testExpiresAt: null, testDetail: null, clientName: null, clientVersion: null, lastSeenAt: null } });
  await revokeApiToken(session, c.tokenId);
  const [row] = await loadRows(session.id, id);
  return result({ connection: connectionView(row), token: t.token });
}

export async function deleteConnection(session: SessionUser, id: string) {
  const c = await prisma.agentConnection.findFirst({ where: { id, userId: session.id } });
  if (!c) return result({ error: "连接不存在" }, { status: 404 });
  await revokeApiToken(session, c.tokenId);
  await prisma.agentConnection.delete({ where: { id } });
  return result({ ok: true });
}

/** 开始测试：服务端检查令牌和权限，生成一次性测试码（15 分钟有效） */
export async function startTest(session: SessionUser, id: string, toolCount: number) {
  const [c] = await loadRows(session.id, id);
  if (!c) return result({ error: "连接不存在" }, { status: 404 });
  const checks: { ok: boolean; label: string }[] = [];
  const ok = tokenOk(c.token);
  checks.push({ ok, label: ok ? `令牌有效${c.token.expiresAt ? `，${Math.max(0, Math.ceil((c.token.expiresAt.getTime() - Date.now()) / 864e5))} 天后到期` : ""}` : "令牌已吊销或过期，请换令牌" });
  const readScopes = c.token.scopes.filter((s) => s.endsWith(".read")).length;
  checks.push({ ok: c.token.scopes.length > 0, label: `${c.token.scopes.length} 项权限（读取 ${readScopes} 项）${c.token.scopes.includes("docs.edit") ? "，能领测试、回传结果" : "，没有「编辑文档」：不能领「在我的电脑执行」的测试"}` });
  checks.push({ ok: toolCount > 0, label: `${toolCount} 个工具可用` });
  if (!ok) return result({ checks, connection: connectionView(c) });
  const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await prisma.agentConnection.update({ where: { id }, data: { testCode: code, testExpiresAt: new Date(Date.now() + TEST_MINUTES * 60_000), lastTestAt: new Date(), testDetail: null } });
  const [row] = await loadRows(session.id, id);
  return result({ checks, connection: connectionView(row) });
}

export async function getConnection(session: SessionUser, id: string) {
  const [c] = await loadRows(session.id, id);
  if (!c) return result({ error: "连接不存在" }, { status: 404 });
  return result({ connection: connectionView(c) });
}

// ---------- MCP 一侧（令牌身份） ----------

/** MCP initialize：记下 Agent 报的名字和版本 */
export async function recordClient(tokenId: string, info: unknown) {
  const i = (info && typeof info === "object" ? info : {}) as { name?: unknown; version?: unknown };
  const name = String(i.name || "").slice(0, 80) || null;
  const version = String(i.version || "").slice(0, 40) || null;
  await prisma.agentConnection.updateMany({ where: { tokenId }, data: { clientName: name, clientVersion: version, lastSeenAt: new Date() } });
}

/** 每次调用刷新「最近使用」（一分钟内只写一次） */
export async function touchClient(tokenId: string) {
  await prisma.agentConnection.updateMany({ where: { tokenId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { lastSeenAt: new Date() } });
}

/**
 * weavi_connection_test：Agent 带测试码调用。只认这张令牌对应连接的测试码，过期或不对都不算。
 * readCheck 由 MCP 层传入：用这张令牌真的读一次项目列表，确认读权限可用。
 */
export async function passTest(tokenId: string, code: unknown, readCheck: () => Promise<{ ok: boolean; count: number }>) {
  const c = await prisma.agentConnection.findUnique({ where: { tokenId } });
  if (!c) return { ok: false, message: "这张令牌不是「本机 Agent」里创建的，不用测试；到 设置 › 本机 Agent 添加后再测。" };
  const given = String(code || "").trim().toUpperCase();
  if (!c.testCode || !c.testExpiresAt || c.testExpiresAt.getTime() <= Date.now()) return { ok: false, message: "测试码已过期或还没开始测试：请在 设置 › 本机 Agent 里点「测试连接」拿新的测试码。" };
  if (given !== c.testCode) return { ok: false, message: "测试码不对，请照设置页里显示的测试码重新调用。" };
  const read = await readCheck().catch(() => ({ ok: false, count: 0 }));
  const detail = read.ok ? `读取项目正常（能看到 ${read.count} 个项目）` : "连上了，但读取项目失败：检查令牌权限";
  await prisma.agentConnection.update({ where: { id: c.id }, data: { verifiedAt: new Date(), testCode: null, testExpiresAt: null, testDetail: detail, lastSeenAt: new Date() } });
  return { ok: true, message: `连通测试通过：小围空间已收到「${c.name}」的调用，${detail}。现在可以用小围空间的工具了。` };
}
