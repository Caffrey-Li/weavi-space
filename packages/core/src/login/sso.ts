import { prisma } from "@pm-collab/db/prisma";
import { level2OrgId, listOrgs } from "../shared/org";
import { phoneHash, normalizePhone } from "./phone";
import type { ProviderConfig, SsoKind } from "./providers";

/**
 * 飞书 / 企业微信 / 钉钉扫码登录（每个企业用自己的应用）：
 * 授权 → 回调换取用户 id → 按「已绑定身份 → 邀请 / 重置链接 → 本企业已验证的企业邮箱或手机号」找账号。
 * 找不到就拒绝（不自动开通，账号由管理员邀请）。不同步组织架构。
 */
export class SsoError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

export type ExternalUser = { externalId: string; name?: string; email?: string; mobile?: string; avatarUrl?: string };

export function ssoCallbackPath(kind: SsoKind) {
  return `/api/auth/sso/${kind}/callback`;
}

export function ssoRedirectUri(req: Request, kind: SsoKind) {
  const path = ssoCallbackPath(kind);
  const site = process.env.APP_URL || process.env.URL;
  if (site) return new URL(path, site).toString();
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}${path}` : new URL(path, req.url).toString();
}

export function authorizeUrl(kind: SsoKind, cfg: ProviderConfig, state: string, redirectUri: string) {
  if (kind === "feishu") {
    return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${new URLSearchParams({ client_id: String(cfg.appId), response_type: "code", redirect_uri: redirectUri, state })}`;
  }
  if (kind === "wecom") {
    return `https://login.work.weixin.qq.com/wwlogin/sso/login?${new URLSearchParams({ login_type: "CorpApp", appid: String(cfg.corpId), agentid: String(cfg.agentId), redirect_uri: redirectUri, state })}`;
  }
  return `https://login.dingtalk.com/oauth2/auth?${new URLSearchParams({ redirect_uri: redirectUri, response_type: "code", client_id: String(cfg.clientId), scope: "openid", state, prompt: "consent" })}`;
}

async function json(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** 用授权码换第三方用户信息 */
export async function exchangeCode(kind: SsoKind, cfg: ProviderConfig, code: string, redirectUri: string): Promise<ExternalUser> {
  if (kind === "feishu") {
    const t = await json(
      await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ grant_type: "authorization_code", client_id: cfg.appId, client_secret: cfg.appSecret, code, redirect_uri: redirectUri }),
        cache: "no-store",
      }),
    );
    if (t.code !== 0 || !t.access_token) throw new SsoError("token", "换取飞书令牌失败");
    const u = await json(await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" }));
    const d = (u.data || {}) as Record<string, string>;
    if (u.code !== 0 || !d.open_id) throw new SsoError("userinfo", "读取飞书用户信息失败");
    return { externalId: d.open_id, name: d.name || d.en_name, email: d.enterprise_email, mobile: d.mobile, avatarUrl: d.avatar_url };
  }
  if (kind === "wecom") {
    const t = await json(await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${new URLSearchParams({ corpid: String(cfg.corpId), corpsecret: String(cfg.secret) })}`, { cache: "no-store" }));
    if (t.errcode !== 0 || !t.access_token) throw new SsoError("token", "获取企业微信令牌失败");
    const u = await json(await fetch(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?${new URLSearchParams({ access_token: String(t.access_token), code })}`, { cache: "no-store" }));
    if (u.errcode !== 0 || !u.userid) throw new SsoError(u.openid ? "not_member" : "userinfo", u.openid ? "这个企业微信账号不是本企业成员" : "读取企业微信用户失败");
    return { externalId: String(u.userid) };
  }
  const t = await json(
    await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, code, grantType: "authorization_code" }),
      cache: "no-store",
    }),
  );
  if (!t.accessToken) throw new SsoError("token", "获取钉钉令牌失败");
  const u = await json(await fetch("https://api.dingtalk.com/v1.0/contact/users/me", { headers: { "x-acs-dingtalk-access-token": String(t.accessToken) }, cache: "no-store" }));
  if (!u.unionId) throw new SsoError("userinfo", "读取钉钉用户信息失败");
  return { externalId: String(u.unionId), name: u.nick as string | undefined, mobile: u.mobile as string | undefined, avatarUrl: u.avatarUrl as string | undefined };
}

/** 账号是否属于这个范围：企业范围要求在该企业（含下级部门）；系统级不限 */
export async function inScope(orgId: string | null, scope: string) {
  if (!scope) return true;
  return level2OrgId(await listOrgs(), orgId) === scope;
}

/**
 * 找本系统账号：
 * 1. 已绑定的身份；
 * 2. 带了有效的邀请 / 重置链接（linkUserId）→ 绑定到该账号；
 * 3. 企业范围下，飞书返回的企业邮箱、钉钉返回的手机号与本企业账号一致 → 绑定（企业自己的应用已核验过）。
 */
export async function resolveSsoUser(kind: SsoKind, scope: string, ext: ExternalUser, linkUserId?: string | null) {
  const identity = await prisma.userIdentity.findUnique({ where: { provider_scope_externalId: { provider: kind, scope, externalId: ext.externalId } }, include: { user: true } });
  let user = identity?.user ?? null;
  if (user && linkUserId && user.id !== linkUserId) throw new SsoError("conflict", "这个账号已经绑定了本系统的其他用户");
  if (!user && linkUserId) user = await prisma.user.findUnique({ where: { id: linkUserId } });
  if (!user && scope) {
    const email = ext.email?.trim().toLowerCase();
    if (kind === "feishu" && email) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
      if (rows[0]) user = await prisma.user.findUnique({ where: { id: rows[0].id } });
    }
    const phone = kind === "dingtalk" ? normalizePhone(ext.mobile) : null;
    if (!user && phone) user = await prisma.user.findUnique({ where: { phoneHash: phoneHash(phone) } });
    if (user && !(await inScope(user.orgId, scope))) user = null;
  }
  if (!user) throw new SsoError("not_member", "这个账号还没有开通，请联系企业管理员邀请");
  if (!user.isActive) throw new SsoError("inactive", "账号已停用，请联系管理员");
  if (!(await inScope(user.orgId, scope))) throw new SsoError("not_member", "这个账号不属于该企业");
  if (!identity) {
    const taken = await prisma.userIdentity.findFirst({ where: { userId: user.id, provider: kind, scope } });
    if (taken && taken.externalId !== ext.externalId) throw new SsoError("conflict", "这个账号已绑定其他第三方账号，请联系管理员");
    if (!taken) await prisma.userIdentity.create({ data: { userId: user.id, provider: kind, scope, externalId: ext.externalId } });
  }
  return user;
}
