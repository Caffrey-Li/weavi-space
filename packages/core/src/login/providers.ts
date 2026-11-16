import { prisma } from "@pm-collab/db/prisma";
import { getStoredFeishu, mask, openText, sealText } from "../shared/secure-config";

/**
 * 登录方式（设置 · 登录管理）。scope = 企业 id；"" = 系统级。
 * - 飞书 / 企业微信 / 钉钉：每个企业用自己的应用，扫码登录，不同步组织架构；
 * - 邮箱验证码 / 手机验证码：发送通道（SMTP、阿里云短信）只在系统级配置，企业只能开关；
 * - 企业微信、钉钉的云表格 / 云文档另有入口，与这里无关。
 */
export const LOGIN_KINDS = ["feishu", "wecom", "dingtalk", "email", "sms"] as const;
export type LoginKind = (typeof LOGIN_KINDS)[number];
export const SSO_KINDS = ["feishu", "wecom", "dingtalk"] as const;
export type SsoKind = (typeof SSO_KINDS)[number];

type Field = { key: string; label: string; secret?: boolean; placeholder?: string; type?: "text" | "number" | "boolean" };
export const KIND_META: Record<LoginKind, { label: string; fields: Field[]; channel?: boolean }> = {
  feishu: { label: "飞书", fields: [{ key: "appId", label: "App ID", placeholder: "cli_xxx" }, { key: "appSecret", label: "App Secret", secret: true }] },
  wecom: {
    label: "企业微信",
    fields: [
      { key: "corpId", label: "企业 ID（CorpID）" },
      { key: "agentId", label: "应用 AgentId" },
      { key: "secret", label: "应用 Secret", secret: true },
    ],
  },
  dingtalk: { label: "钉钉", fields: [{ key: "clientId", label: "Client ID（AppKey）" }, { key: "clientSecret", label: "Client Secret（AppSecret）", secret: true }] },
  email: {
    label: "邮箱验证码",
    channel: true,
    fields: [
      { key: "host", label: "SMTP 服务器", placeholder: "smtp.exmail.qq.com" },
      { key: "port", label: "端口", type: "number", placeholder: "465" },
      { key: "secure", label: "使用 SSL", type: "boolean" },
      { key: "user", label: "账号" },
      { key: "pass", label: "密码 / 授权码", secret: true },
      { key: "from", label: "发件人", placeholder: "Weavi Space <noreply@example.com>" },
    ],
  },
  sms: {
    label: "手机验证码",
    channel: true,
    fields: [
      { key: "accessKeyId", label: "阿里云 AccessKey ID" },
      { key: "accessKeySecret", label: "AccessKey Secret", secret: true },
      { key: "signName", label: "短信签名" },
      { key: "templateCode", label: "验证码模板 CODE", placeholder: "SMS_123456789（变量名 code）" },
    ],
  },
};

export type ProviderConfig = Record<string, string | boolean | undefined>;

export function isLoginKind(k: unknown): k is LoginKind {
  return (LOGIN_KINDS as readonly string[]).includes(String(k));
}

async function row(scope: string, kind: LoginKind) {
  return prisma.loginProvider.findUnique({ where: { scope_kind: { scope, kind } } });
}

function parse(enc: string | null | undefined): ProviderConfig {
  const plain = openText(enc);
  if (!plain) return {};
  try {
    return JSON.parse(plain) as ProviderConfig;
  } catch {
    return {};
  }
}

/** 必填字段是否齐全（boolean 字段不算） */
export function complete(kind: LoginKind, cfg: ProviderConfig) {
  return KIND_META[kind].fields.filter((f) => f.type !== "boolean" && f.key !== "port").every((f) => String(cfg[f.key] ?? "").trim());
}

/** 读配置（含密钥，只在服务端用）。系统级飞书没有新配置时沿用旧的「飞书登录」设置 */
export async function providerConfig(scope: string, kind: LoginKind): Promise<{ enabled: boolean; config: ProviderConfig } | null> {
  const r = await row(scope, kind);
  if (r) return { enabled: r.enabled, config: parse(r.configEnc) };
  if (scope === "" && kind === "feishu") {
    const old = await getStoredFeishu();
    if (old) return { enabled: true, config: { appId: old.appId, appSecret: old.appSecret, redirectUri: old.redirectUri } };
  }
  return null;
}

/** 这个范围下真正可用的方式：开了且配置完整；邮箱 / 短信还要求系统级通道已配好 */
export async function usableKinds(scope: string): Promise<LoginKind[]> {
  const out: LoginKind[] = [];
  for (const kind of LOGIN_KINDS) {
    const p = await providerConfig(scope, kind);
    if (!p?.enabled) continue;
    if (KIND_META[kind].channel) {
      const ch = scope === "" ? p : await providerConfig("", kind);
      if (ch && complete(kind, ch.config)) out.push(kind);
    } else if (complete(kind, p.config)) out.push(kind);
  }
  return out;
}

/** 给前端看的配置：密钥字段只显示是否已填和脱敏值 */
export async function listProviders(scope: string) {
  const items = [];
  for (const kind of LOGIN_KINDS) {
    const p = await providerConfig(scope, kind);
    const cfg = p?.config || {};
    const channelOnly = Boolean(KIND_META[kind].channel) && scope !== "";
    const channel = channelOnly ? await providerConfig("", kind) : null;
    items.push({
      kind,
      label: KIND_META[kind].label,
      enabled: Boolean(p?.enabled),
      /** 企业范围下的邮箱 / 短信：只能开关，发送通道由系统超管配置 */
      channelOnly,
      channelReady: channelOnly ? Boolean(channel && complete(kind, channel.config)) : undefined,
      ready: channelOnly ? Boolean(channel && complete(kind, channel.config)) : complete(kind, cfg),
      fields: channelOnly
        ? []
        : KIND_META[kind].fields.map((f) => ({
            ...f,
            value: f.secret ? "" : cfg[f.key] ?? "",
            hasValue: Boolean(cfg[f.key]),
            masked: f.secret ? mask(String(cfg[f.key] || "")) : undefined,
          })),
    });
  }
  return items;
}

/** 保存：密钥字段留空 = 沿用旧值 */
export async function saveProvider(scope: string, kind: LoginKind, input: { enabled?: boolean; config?: Record<string, unknown> }, by: string) {
  const cur = await providerConfig(scope, kind);
  const next: ProviderConfig = { ...(cur?.config || {}) };
  const channelOnly = Boolean(KIND_META[kind].channel) && scope !== "";
  if (input.config && !channelOnly) {
    for (const f of KIND_META[kind].fields) {
      if (!(f.key in input.config)) continue;
      const v = input.config[f.key];
      if (f.type === "boolean") next[f.key] = Boolean(v);
      else {
        const s = String(v ?? "").trim().slice(0, 500);
        if (f.secret && !s) continue;
        next[f.key] = s;
      }
    }
  }
  const enabled = input.enabled ?? cur?.enabled ?? false;
  if (enabled && !channelOnly && !complete(kind, next)) return { error: `请先把「${KIND_META[kind].label}」的配置填完整` };
  if (enabled && channelOnly) {
    const ch = await providerConfig("", kind);
    if (!ch || !complete(kind, ch.config)) return { error: `系统超管还没有配置${kind === "email" ? "邮件（SMTP）" : "短信"}发送通道` };
  }
  await prisma.loginProvider.upsert({
    where: { scope_kind: { scope, kind } },
    create: { scope, kind, enabled, configEnc: channelOnly ? null : sealText(JSON.stringify(next)), updatedById: by },
    update: { enabled, ...(channelOnly ? {} : { configEnc: sealText(JSON.stringify(next)) }), updatedById: by },
  });
  return { ok: true as const };
}
