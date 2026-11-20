import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createApiToken, maskedToken, revokeApiToken } from "@pm-collab/core/api-tokens";
import { allowedScopes, policyForUser } from "@pm-collab/core/api-tokens/policy";

export const dynamic = "force-dynamic";

/** 个人 API 令牌（开放接口 v1 和 MCP 用）：明文只在创建时返回一次 */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await prisma.apiToken.findMany({ where: { userId: s.id, revokedAt: null }, select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true, lookupId: true, tokenHint: true, connection: { select: { id: true } } }, orderBy: { createdAt: "desc" } });
  // 本机 Agent 的令牌由「本机 Agent」页管理（换令牌、删除），这里只显示
  const tokens = rows.map(({ lookupId, tokenHint, connection, ...t }) => ({ ...t, masked: maskedToken(lookupId, tokenHint), agentConnectionId: connection?.id ?? null }));
  // T34：只给企业「数据开放」允许的范围；企业关闭令牌时 scopes 为空
  const policy = await policyForUser(s.id);
  return NextResponse.json({ tokens, scopes: allowedScopes(policy), allowTokens: policy.allowTokens });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; scopes?: string[]; days?: number };
  try {
    const days = Number(b.days) || 90;
    const t = await createApiToken(s, { name: String(b.name || ""), scopes: Array.isArray(b.scopes) ? b.scopes : [], expiresAt: new Date(Date.now() + Math.min(365, Math.max(1, days)) * 864e5) });
    return NextResponse.json({ ...t, masked: `nc_pat_${t.token.slice(7, 11)}••••••••${t.token.slice(-4)}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "创建失败" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  return (await revokeApiToken(s, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "令牌不存在" }, { status: 404 });
}
