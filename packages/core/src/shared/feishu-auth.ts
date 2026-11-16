import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { getStoredFeishu } from "./secure-config";
import { safeRedirectPath } from "./safe-path";

/**
 * 飞书网页登录（OAuth 2.0 授权码模式）
 * 1. /api/auth/feishu 跳到飞书授权页（带 state 防 CSRF）
 * 2. 飞书回调 /api/auth/feishu/callback?code=…&state=…
 * 3. 用 code 换 user_access_token，再取用户信息，按 open_id → 邮箱 匹配或新建账号
 */
export const FEISHU_STATE_COOKIE = "pm_feishu_state";
export const FEISHU_FROM_COOKIE = "pm_feishu_from";
const CALLBACK_PATH = "/api/auth/feishu/callback";

type Settings = { appId: string; appSecret: string; redirectUri?: string; autoCreate: boolean; source: "page" | "env" };

/** 配置来源：系统设置里加密保存的优先，其次环境变量 */
export async function feishuSettings(): Promise<Settings | null> {
  // 系统级飞书：「登录管理」里的配置优先（关掉即不可用），没有时沿用旧的「飞书登录」设置
  const { providerConfig, complete } = await import("../login/providers");
  const p = await providerConfig("", "feishu");
  if (p) {
    if (!p.enabled || !complete("feishu", p.config)) return null;
    const old = await getStoredFeishu();
    return { appId: String(p.config.appId), appSecret: String(p.config.appSecret), redirectUri: (p.config.redirectUri as string) || old?.redirectUri, autoCreate: old ? old.autoCreate !== false : false, source: "page" };
  }
  const s = await getStoredFeishu();
  if (s) return { appId: s.appId, appSecret: s.appSecret, redirectUri: s.redirectUri, autoCreate: s.autoCreate !== false, source: "page" };
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    return {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      redirectUri: process.env.FEISHU_REDIRECT_URI,
      autoCreate: process.env.FEISHU_AUTO_CREATE !== "false",
      source: "env",
    };
  }
  return null;
}

export async function isFeishuConfigured() {
  return Boolean(await feishuSettings());
}

/** 回调地址：优先配置里填写的；否则用站点地址（Netlify 自带 URL）或当前请求的域名 */
export function feishuRedirectUri(req: Request, configured?: string) {
  if (configured) return configured;
  const site = process.env.APP_URL || process.env.URL;
  if (site) return new URL(CALLBACK_PATH, site).toString();
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}${CALLBACK_PATH}` : new URL(CALLBACK_PATH, req.url).toString();
}

export function feishuAuthorizeUrl(appId: string, state: string, redirectUri: string) {
  const q = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${q}`;
}

type FeishuUser = {
  name?: string;
  en_name?: string;
  avatar_url?: string;
  open_id: string;
  union_id?: string;
  email?: string;
  enterprise_email?: string;
  tenant_key?: string;
};

export class FeishuLoginError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

async function exchangeCode(cfg: Settings, code: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; access_token?: string; error_description?: string; msg?: string };
  if (!res.ok || data.code !== 0 || !data.access_token) {
    throw new FeishuLoginError("token", `换取飞书令牌失败：${data.error_description || data.msg || res.status}`);
  }
  return data.access_token;
}

async function fetchUser(accessToken: string): Promise<FeishuUser> {
  const res = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: FeishuUser };
  if (!res.ok || data.code !== 0 || !data.data?.open_id) {
    throw new FeishuLoginError("userinfo", `读取飞书用户信息失败：${data.msg || res.status}`);
  }
  return data.data;
}

/** 飞书用户 → 本系统账号：先按 open_id，再按邮箱绑定，都没有时按配置自动开通为普通成员 */
async function resolveUser(fu: FeishuUser, autoCreate: boolean) {
  const tenant = process.env.FEISHU_TENANT_KEY;
  if (tenant && fu.tenant_key !== tenant) {
    throw new FeishuLoginError("tenant", "该飞书账号不属于本企业");
  }
  let user = await prisma.user.findUnique({ where: { feishuOpenId: fu.open_id } });
  const clean = (e?: string) => (e ? e.trim().toLowerCase() : "");
  const emails = [clean(fu.enterprise_email), clean(fu.email)].filter(Boolean);
  // 个人邮箱是飞书用户自己填的，不能作为身份凭据：没有配置 FEISHU_TENANT_KEY 时只按企业邮箱绑定已有账号
  const bindable = tenant ? emails : [clean(fu.enterprise_email)].filter(Boolean);
  if (!user && emails.length) {
    for (const e of emails) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${e} LIMIT 1`;
      if (rows[0]?.id) {
        user = await prisma.user.findUnique({ where: { id: rows[0].id } });
        break;
      }
    }
    if (user && user.feishuOpenId && user.feishuOpenId !== fu.open_id) {
      throw new FeishuLoginError("conflict", "该邮箱对应的账号已绑定其他飞书账号，请联系管理员");
    }
    if (user && !bindable.includes(user.email.toLowerCase())) {
      throw new FeishuLoginError("conflict", "该邮箱对应的账号需要管理员确认后才能绑定飞书");
    }
  }
  if (user) {
    if (!user.isActive) throw new FeishuLoginError("inactive", "账号已停用，请联系管理员");
    return prisma.user.update({
      where: { id: user.id },
      data: {
        feishuOpenId: fu.open_id,
        feishuUnionId: fu.union_id || user.feishuUnionId,
        avatarUrl: user.avatarUrl || fu.avatar_url || null,
      },
    });
  }
  if (!autoCreate) {
    throw new FeishuLoginError("not_member", "该飞书账号还没有开通，请联系管理员添加");
  }
  return prisma.user.create({
    data: {
      email: emails[0] || `feishu_${fu.open_id}`,
      name: fu.name || fu.en_name || "飞书用户",
      avatarUrl: fu.avatar_url || null,
      globalRole: "member",
      feishuOpenId: fu.open_id,
      feishuUnionId: fu.union_id || null,
      mustChangePassword: false,
    },
  });
}

export async function loginWithFeishuCode(cfg: Settings, code: string, redirectUri: string): Promise<SessionUser> {
  const token = await exchangeCode(cfg, code, redirectUri);
  const fu = await fetchUser(token);
  const u = await resolveUser(fu, cfg.autoCreate);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    globalRole: u.globalRole,
    avatarUrl: u.avatarUrl,
    mustChangePassword: false,
  };
}

/** 只允许站内相对路径，防止开放跳转 */
export function safeFrom(from: string | null | undefined) {
  return safeRedirectPath(from);
}
