import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { enterpriseAdminOf } from "../shared/enterprise-admin";
import { level2OrgId, listOrgs, subtreeIds } from "../shared/org";
import { mask, openText, sealText } from "../shared/secure-config";
import { result } from "../nova/result";
import { AI_PROVIDERS, chatStream, listRemoteModels, providerMeta } from "./providers";
import type { Prisma } from "@prisma/client";
import { PERIOD_LABEL, periodStart, quotaFor, remainingTokens, usedTokens } from "./quota";

/** 当前用户所属企业（二级组织）；系统组织里的人为 null */
export async function myEnterprise(user: { id: string }) {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  return level2OrgId(await listOrgs(), me?.orgId);
}

/** 能管哪个企业的模型和定额：企业超管 = 本企业；系统超管 = 指定的企业（默认第一个） */
export async function managedEnterprise(session: SessionUser, wanted?: string | null) {
  if (session.globalRole === ADMIN_ROLE) {
    const ents = await prisma.organization.findMany({ where: { type: "enterprise" }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
    return { list: ents, current: ents.find((e) => e.id === wanted) || ents[0] || null };
  }
  const mine = await enterpriseAdminOf(session.id);
  if (!mine) return { list: [], current: null };
  const org = await prisma.organization.findUnique({ where: { id: mine }, select: { id: true, name: true } });
  return { list: org ? [org] : [], current: org };
}

type CredRow = Awaited<ReturnType<typeof prisma.aiCredential.findMany>>[number];
function view(c: CredRow, remoteModels?: string[]) {
  const key = openText(c.apiKeyEnc) || "";
  return {
    id: c.id,
    ownerType: c.ownerType,
    provider: c.provider,
    providerLabel: providerMeta(c.provider)?.label || c.provider,
    name: c.name,
    baseUrl: c.baseUrl || "",
    keyMasked: mask(key),
    models: c.models,
    enabled: c.enabled,
    testResults: (c.testResults as Record<string, ModelTest> | null) || {},
    ...(remoteModels ? { remoteModels } : {}),
  };
}

async function ownsOrManages(session: SessionUser, c: { ownerType: string; ownerId: string }) {
  if (c.ownerType === "user") return c.ownerId === session.id;
  if (session.globalRole === ADMIN_ROLE) return true;
  return (await enterpriseAdminOf(session.id)) === c.ownerId;
}

export async function settingsGET(session: SessionUser, enterpriseWanted: string | null) {
  const personal = await prisma.aiCredential.findMany({ where: { ownerType: "user", ownerId: session.id }, orderBy: { createdAt: "asc" } });
  const ent = await managedEnterprise(session, enterpriseWanted);
  let enterprise = null;
  if (ent.current) {
    const orgs = await listOrgs();
    const [creds, quotas, members] = await Promise.all([
      prisma.aiCredential.findMany({ where: { ownerType: "enterprise", ownerId: ent.current.id }, orderBy: { createdAt: "asc" } }),
      prisma.aiQuota.findMany({ where: { enterpriseId: ent.current.id } }),
      prisma.user.findMany({ where: { orgId: { in: subtreeIds(orgs, ent.current.id) }, isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    ]);
    const def = quotas.find((q) => q.userId === "") || null;
    const rows = [];
    for (const m of members) {
      const q = quotas.find((x) => x.userId === m.id) || def;
      rows.push({ ...m, custom: quotas.some((x) => x.userId === m.id), period: q?.period || null, limit: q?.tokenLimit ?? null, used: q ? await usedTokens(ent.current.id, m.id, periodStart(q.period)) : 0 });
    }
    enterprise = { id: ent.current.id, name: ent.current.name, list: ent.list, credentials: creds.map((c) => view(c)), defaultQuota: def ? { period: def.period, limit: def.tokenLimit } : null, members: rows };
  }
  return result({ providers: AI_PROVIDERS, personal: personal.map((c) => view(c)), enterprise, periods: PERIOD_LABEL });
}

/** 新建凭据：先用 Key 拉一次模型列表，拉不到就不保存 */
export async function createCredential(session: SessionUser, body: Record<string, unknown>) {
  const provider = String(body.provider || "");
  const meta = providerMeta(provider);
  if (!meta) return result({ error: "请选择模型厂商" }, { status: 400 });
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey || apiKey.length > 500) return result({ error: "请填写 API Key" }, { status: 400 });
  const baseUrl = String(body.baseUrl || "").trim().slice(0, 300) || null;
  if (provider === "openai_compat" && !baseUrl) return result({ error: "自定义厂商需要填写接口地址" }, { status: 400 });
  const name = String(body.name || "").trim().slice(0, 40) || meta.label;
  let ownerType = "user";
  let ownerId = session.id;
  if (body.ownerType === "enterprise") {
    const ent = await managedEnterprise(session, String(body.enterpriseId || ""));
    if (!ent.current || (body.enterpriseId && ent.current.id !== body.enterpriseId)) return result({ error: "只有企业超管可以配置企业模型" }, { status: 403 });
    ownerType = "enterprise";
    ownerId = ent.current.id;
  }
  let models: string[] = [];
  try {
    models = await listRemoteModels({ provider, baseUrl, apiKey });
  } catch (e) {
    return result({ error: `用这个 Key 拉取模型失败：${(e as Error).message}` }, { status: 400 });
  }
  if (!models.length) return result({ error: "这个 Key 没有可用的模型" }, { status: 400 });
  const c = await prisma.aiCredential.create({ data: { ownerType, ownerId, provider, name, baseUrl, apiKeyEnc: sealText(apiKey), models: models.slice(0, 200), createdById: session.id } });
  return result({ credential: view(c, models) });
}

/** 改名称 / 勾选模型 / 启停 / 换 Key / 重新拉取 */
export async function updateCredential(session: SessionUser, id: string, body: Record<string, unknown>) {
  const c = await prisma.aiCredential.findUnique({ where: { id } });
  if (!c || !(await ownsOrManages(session, c))) return result({ error: "模型配置不存在" }, { status: 404 });
  const data: { name?: string; models?: string[]; enabled?: boolean; apiKeyEnc?: string } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 40);
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  let remote: string[] | undefined;
  const newKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (newKey || body.refresh === true) {
    try {
      remote = await listRemoteModels({ provider: c.provider, baseUrl: c.baseUrl, apiKey: newKey || openText(c.apiKeyEnc) || "" });
    } catch (e) {
      return result({ error: `拉取模型失败：${(e as Error).message}` }, { status: 400 });
    }
    if (newKey) data.apiKeyEnc = sealText(newKey);
  }
  if (Array.isArray(body.models)) data.models = body.models.map(String).filter(Boolean).slice(0, 200);
  else if (remote) data.models = remote.slice(0, 200);
  const u = await prisma.aiCredential.update({ where: { id }, data });
  return result({ credential: view(u, remote) });
}

export async function deleteCredential(session: SessionUser, id: string) {
  const c = await prisma.aiCredential.findUnique({ where: { id } });
  if (!c || !(await ownsOrManages(session, c))) return result({ error: "模型配置不存在" }, { status: 404 });
  await prisma.aiCredential.delete({ where: { id } });
  return result({ ok: true });
}

/** 设定额：{ enterpriseId, userId（空 = 企业默认）, period, tokenLimit（null = 删除） } */
export async function setQuota(session: SessionUser, body: Record<string, unknown>) {
  const ent = await managedEnterprise(session, String(body.enterpriseId || ""));
  if (!ent.current || ent.current.id !== body.enterpriseId) return result({ error: "只有企业超管可以设置定额" }, { status: 403 });
  const userId = String(body.userId || "");
  if (userId) {
    const orgs = await listOrgs();
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (!u || level2OrgId(orgs, u.orgId) !== ent.current.id) return result({ error: "只能给本企业成员设置定额" }, { status: 400 });
  }
  if (body.tokenLimit === null || body.tokenLimit === "") {
    await prisma.aiQuota.deleteMany({ where: { enterpriseId: ent.current.id, userId } });
    return result({ ok: true });
  }
  const limit = Math.floor(Number(body.tokenLimit));
  const period = ["day", "week", "month"].includes(String(body.period)) ? String(body.period) : "month";
  if (!Number.isFinite(limit) || limit < 0 || limit > 1e10) return result({ error: "定额要是 0 以上的整数" }, { status: 400 });
  await prisma.aiQuota.upsert({ where: { enterpriseId_userId: { enterpriseId: ent.current.id, userId } }, create: { enterpriseId: ent.current.id, userId, period, tokenLimit: limit }, update: { period, tokenLimit: limit } });
  return result({ ok: true });
}

export type ModelOption = { credentialId: string; model: string; label: string; source: "enterprise" | "personal"; disabled: boolean; reason?: string };

/** AI 助手可选的模型：企业模型排前面；企业额度用完时不可选并提示 token 不足 */
export async function availableModels(session: SessionUser) {
  const ent = await myEnterprise(session);
  const [entCreds, mine] = await Promise.all([
    ent ? prisma.aiCredential.findMany({ where: { ownerType: "enterprise", ownerId: ent, enabled: true }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    prisma.aiCredential.findMany({ where: { ownerType: "user", ownerId: session.id, enabled: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const quota = ent ? await remainingTokens(ent, session.id) : null;
  const out: ModelOption[] = [];
  const exhausted = Boolean(quota && quota.remaining !== null && quota.remaining <= 0);
  for (const c of entCreds) for (const m of c.models) out.push({ credentialId: c.id, model: m, label: `${c.name} · ${m}`, source: "enterprise", disabled: exhausted, reason: exhausted ? `企业分配的 token 已用完（${PERIOD_LABEL[quota!.period!]} ${quota!.limit} tokens）` : undefined });
  for (const c of mine) for (const m of c.models) out.push({ credentialId: c.id, model: m, label: `${c.name} · ${m}`, source: "personal", disabled: false });
  return { options: out, quota };
}

/** 调用前取凭据：校验归属和额度 */
export async function credentialForUse(session: SessionUser, credentialId: string, model: string) {
  const c = await prisma.aiCredential.findUnique({ where: { id: credentialId } });
  if (!c || !c.enabled || !c.models.includes(model)) return { error: "模型不可用，请重新选择" } as const;
  const ent = await myEnterprise(session);
  if (c.ownerType === "user" && c.ownerId !== session.id) return { error: "模型不可用，请重新选择" } as const;
  if (c.ownerType === "enterprise") {
    if (c.ownerId !== ent) return { error: "模型不可用，请重新选择" } as const;
    const q = await remainingTokens(ent, session.id);
    if (q.remaining !== null && q.remaining <= 0) return { error: "token 不足：企业分配给你的额度已用完，请联系企业管理员或改用个人模型" } as const;
  }
  return { cred: { provider: c.provider, baseUrl: c.baseUrl, apiKey: openText(c.apiKeyEnc) || "" }, billedTo: c.ownerType === "enterprise" ? ("enterprise" as const) : ("user" as const), enterpriseId: ent, credentialId: c.id };
}

export { quotaFor };

// ---------- 连接测试（T29） ----------

export type ModelTest = { ok: boolean; at: string; ttftMs: number | null; totalMs: number; tokensPerSec: number | null; thinking: boolean; reply: string; error: string | null };

/** 测一个模型：发一句很短的话，量首字延迟、总耗时、输出速度，看有没有思考过程 */
export async function testOneModel(cred: { provider: string; baseUrl?: string | null; apiKey: string }, model: string): Promise<ModelTest> {
  const t0 = Date.now();
  let first: number | null = null;
  let firstText: number | null = null;
  try {
    const out = await chatStream(cred, model, "这是一次连接测试。", [{ role: "user", content: "请只回复四个字：连接正常" }], 1024, {
      idleMs: 30_000,
      totalMs: 90_000,
      onDelta: (d) => {
        const now = Date.now() - t0;
        if (first === null) first = now;
        if (d.kind === "text" && firstText === null) firstText = now;
      },
    });
    const totalMs = Date.now() - t0;
    const genMs = first === null ? totalMs : Math.max(1, totalMs - first);
    const tokensPerSec = out.outputTokens ? Math.round((out.outputTokens / genMs) * 1000 * 10) / 10 : null;
    const reply = out.text.trim().slice(0, 40);
    const ok = !!reply;
    return {
      ok,
      at: new Date().toISOString(),
      ttftMs: first,
      totalMs,
      tokensPerSec,
      thinking: out.thinkChars > 0,
      reply,
      error: ok ? null : out.thinkChars ? "只返回了思考过程，没有正文：这个模型思考较长，生成 PRD 这类长内容时会占用较多输出额度" : "模型没有返回内容",
    };
  } catch (e) {
    return { ok: false, at: new Date().toISOString(), ttftMs: first, totalMs: Date.now() - t0, tokensPerSec: null, thinking: false, reply: "", error: String((e as Error).message || "调用失败").slice(0, 200) };
  }
}

/** 测试连接：{ model? }（不传测这个 Key 勾选的全部模型，最多 6 个）。先拉模型列表看 Key 和地址，再逐个模型发一句话 */
export async function testCredential(session: SessionUser, id: string, body: Record<string, unknown>) {
  const c = await prisma.aiCredential.findUnique({ where: { id } });
  if (!c || !(await ownsOrManages(session, c))) return result({ error: "模型配置不存在" }, { status: 404 });
  const cred = { provider: c.provider, baseUrl: c.baseUrl, apiKey: openText(c.apiKeyEnc) || "" };
  const t0 = Date.now();
  let connect: { ok: boolean; ms: number; models: number; error: string | null };
  try {
    const list = await listRemoteModels(cred);
    connect = { ok: true, ms: Date.now() - t0, models: list.length, error: null };
  } catch (e) {
    connect = { ok: false, ms: Date.now() - t0, models: 0, error: String((e as Error).message || "连接失败").slice(0, 200) };
  }
  const want = typeof body.model === "string" && body.model ? [body.model].filter((m) => c.models.includes(m)) : c.models.slice(0, 6);
  const results: Record<string, ModelTest> = {};
  // 连不上就不逐个测了，原因都一样
  if (connect.ok) for (const m of want) results[m] = await testOneModel(cred, m);
  else for (const m of want) results[m] = { ok: false, at: new Date().toISOString(), ttftMs: null, totalMs: connect.ms, tokensPerSec: null, thinking: false, reply: "", error: connect.error };
  const merged = { ...((c.testResults as Record<string, ModelTest> | null) || {}), ...results };
  await prisma.aiCredential.update({ where: { id }, data: { testResults: merged as unknown as Prisma.InputJsonObject } });
  return result({ connect, results });
}
