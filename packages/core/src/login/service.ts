import type { SessionUser } from "../auth";
import { guestDemoEnabled } from "./guest";
import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { enterpriseAdminOf } from "../shared/enterprise-admin";
import { result } from "../nova/result";
import { KIND_META, LOGIN_KINDS, SSO_KINDS, isLoginKind, listProviders, saveProvider, usableKinds } from "./providers";
import { sendMail, sendSmsCode } from "./channels";
import { createCode, peekLinkToken, failLinkToken, consumeLinkToken, verifyCode } from "./tokens";
import { inScope } from "./sso";
import { normalizePhone, phoneHash } from "./phone";

/** 专属登录链接 ?org=<企业编码> → 企业范围；没有或找不到 → 系统级（""） */
export async function scopeFromOrgCode(code: string | null | undefined) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return { scope: "", enterprise: null as null | { id: string; name: string; code: string | null } };
  const org = await prisma.organization.findFirst({ where: { code: c, type: "enterprise" }, select: { id: true, name: true, code: true } });
  return org ? { scope: org.id, enterprise: org } : { scope: "", enterprise: null };
}

/** 登录页可用的方式（公开接口）：只返回开关结果，不返回任何配置 */
export async function loginOptions(orgCode: string | null) {
  const { scope, enterprise } = await scopeFromOrgCode(orgCode);
  const kinds = await usableKinds(scope);
  return {
    enterprise: enterprise ? { name: enterprise.name, code: enterprise.code } : null,
    unknownOrg: Boolean(orgCode && !enterprise),
    password: true,
    sso: SSO_KINDS.filter((k) => kinds.includes(k)).map((k) => ({ kind: k, label: KIND_META[k].label })),
    email: kinds.includes("email"),
    sms: kinds.includes("sms"),
    guestDemo: guestDemoEnabled(),
  };
}

/** 能管理哪些范围的登录方式：系统超管 = 系统级 + 全部企业；企业超管 = 本企业 */
async function manageableScopes(session: SessionUser) {
  if (session.globalRole === ADMIN_ROLE) {
    const ents = await prisma.organization.findMany({ where: { type: "enterprise" }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
    return [{ id: "", name: "Weavi Space 系统（系统级）" }, ...ents];
  }
  const mine = await enterpriseAdminOf(session.id);
  if (!mine) return [];
  const org = await prisma.organization.findUnique({ where: { id: mine }, select: { id: true, name: true } });
  return org ? [org] : [];
}

export async function adminGET(session: SessionUser, scopeRaw: string | null) {
  const scopes = await manageableScopes(session);
  if (!scopes.length) return result({ error: "只有系统超管和企业超管可以管理登录方式" }, { status: 403 });
  const scope = scopeRaw !== null && scopes.some((s) => s.id === scopeRaw) ? scopeRaw : scopes[0].id;
  return result({ scopes, scope, providers: await listProviders(scope), kinds: LOGIN_KINDS });
}

export async function adminPUT(session: SessionUser, body: Record<string, unknown>) {
  const scopes = await manageableScopes(session);
  if (!scopes.length) return result({ error: "只有系统超管和企业超管可以管理登录方式" }, { status: 403 });
  const scope = String(body.scope ?? "");
  const kind = body.kind;
  if (!isLoginKind(kind)) return result({ error: "登录方式不存在" }, { status: 400 });
  if (!scopes.some((s) => s.id === scope)) return result({ error: "只能配置自己企业的登录方式" }, { status: 403 });
  const r = await saveProvider(scope, kind, { enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, config: (body.config as Record<string, unknown>) || undefined }, session.id);
  if ("error" in r) return result({ error: r.error }, { status: 400 });
  await prisma.activityLog.create({ data: { entityType: "login_provider", entityId: `${scope || "system"}:${kind}`, action: "updated", actorId: session.id, toValue: JSON.stringify({ enabled: body.enabled }) } });
  return result({ ok: true, providers: await listProviders(scope) });
}

/** 按邮箱或手机号找账号（企业范围内） */
async function findByTarget(channel: "email" | "sms", target: string, scope: string) {
  let user = null;
  if (channel === "email") {
    const e = target.trim().toLowerCase();
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${e} LIMIT 1`;
    if (rows[0]) user = await prisma.user.findUnique({ where: { id: rows[0].id } });
  } else {
    const p = normalizePhone(target);
    if (p) user = await prisma.user.findUnique({ where: { phoneHash: phoneHash(p) } });
  }
  if (!user || !user.isActive || !(await inScope(user.orgId, scope))) return null;
  return user;
}

const SENT = "如果账号存在，验证码已发送，10 分钟内有效";

/** 发送登录验证码：不论账号是否存在都回同样的话，避免枚举 */
export async function sendLoginCode(body: Record<string, unknown>) {
  const channel = body.channel === "sms" ? "sms" : body.channel === "email" ? "email" : null;
  const target = String(body.target || "").slice(0, 120);
  if (!channel || !target) return result({ error: "请填写邮箱或手机号" }, { status: 400 });
  const { scope } = await scopeFromOrgCode(body.org as string);
  if (!(await usableKinds(scope)).includes(channel)) return result({ error: "这个登录方式没有开通" }, { status: 400 });
  const user = await findByTarget(channel, target, scope);
  if (!user) return result({ ok: true, message: SENT });
  const code = await createCode(user.id, channel);
  if (!code) return result({ ok: true, message: SENT });
  try {
    if (channel === "email") await sendMail(user.email, "小围空间登录验证码", `你的登录验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略。`);
    else await sendSmsCode(normalizePhone(target)!, code);
  } catch (e) {
    console.error("send login code failed", e);
    return result({ error: "验证码发送失败，请稍后再试或联系管理员" }, { status: 502 });
  }
  return result({ ok: true, message: SENT });
}

/** 校验验证码，成功返回账号（由路由开会话） */
export async function verifyLoginCode(body: Record<string, unknown>) {
  const channel = body.channel === "sms" ? "sms" : body.channel === "email" ? "email" : null;
  const target = String(body.target || "").slice(0, 120);
  const code = String(body.code || "").slice(0, 10);
  if (!channel || !target || !code) return { error: "请填写验证码", status: 400 } as const;
  const { scope } = await scopeFromOrgCode(body.org as string);
  if (!(await usableKinds(scope)).includes(channel)) return { error: "这个登录方式没有开通", status: 400 } as const;
  const user = await findByTarget(channel, target, scope);
  if (!user || !(await verifyCode(user.id, code))) return { error: "验证码错误或已过期", status: 401 } as const;
  return { user };
}

/** 邀请 / 重置链接页的公开信息：企业名、脱敏邮箱、可用的第三方登录 */
export async function linkInfo(raw: string) {
  const t = await peekLinkToken(raw);
  if (!t) return null;
  const orgs = await prisma.organization.findMany({ where: { type: "enterprise" }, select: { id: true, name: true, code: true } });
  const { level2OrgId, listOrgs } = await import("../shared/org");
  const entId = level2OrgId(await listOrgs(), t.user.orgId);
  const ent = orgs.find((o) => o.id === entId) || null;
  const kinds = await usableKinds(ent?.id || "");
  const [name, domain] = t.user.email.split("@");
  return {
    purpose: t.purpose as "invite" | "reset",
    userName: t.user.name,
    emailHint: domain ? `${name.slice(0, 1)}***@${domain}` : `${t.user.email.slice(0, 1)}***`,
    enterprise: ent ? { name: ent.name, code: ent.code } : null,
    sso: SSO_KINDS.filter((k) => kinds.includes(k)).map((k) => ({ kind: k, label: KIND_META[k].label })),
  };
}

/** 凭邀请 / 重置链接登录：要求填写账号邮箱（或手机号）与链接对应的账号一致；错 5 次链接作废 */
export async function acceptLink(raw: string, account: string) {
  const t = await peekLinkToken(raw);
  if (!t) return { error: "链接无效或已过期，请联系管理员重新发送", status: 410 } as const;
  const a = String(account || "").trim().toLowerCase();
  const phone = normalizePhone(a);
  const ok = a === t.user.email.toLowerCase() || Boolean(phone && t.user.phoneHash && phoneHash(phone) === t.user.phoneHash);
  if (!ok) {
    await failLinkToken(t.id);
    return { error: "邮箱或手机号与邀请的账号不一致", status: 400 } as const;
  }
  if (!(await consumeLinkToken(t.id))) return { error: "链接已被使用", status: 410 } as const;
  return { user: t.user, purpose: t.purpose };
}
