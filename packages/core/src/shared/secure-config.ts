import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";
import { storage } from "./storage";
import { authSecretString } from "./auth-secret";

/**
 * 加密保存的系统配置（目前只有飞书登录）。
 * - 内容用 AES-256-GCM 加密，存储里只有密文。密文带 keyVersion：
 *   2 = 由独立的 ENCRYPTION_KEY 派生（优先）；1 = 由 AUTH_SECRET 派生（旧数据，没有 keyVersion 的也按 1 读）。
 *   配置 ENCRYPTION_KEY 后旧密文照常能读，下一次写入时自动换成 keyVersion 2。
 * - 默认存本地 .data/secure-config.json；配置 S3 时存私有存储桶。
 * - 密钥类字段只写不读：接口和页面永远只拿到掩码。
 */
export type FeishuConfig = {
  appId: string;
  appSecret: string;
  redirectUri?: string;
  autoCreate?: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

/** AI 生图：OpenAI 兼容的 /images/generations 接口（如火山方舟豆包 Seedream） */
export type ImageAiConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  size?: string;
  updatedAt?: string;
  updatedBy?: string;
};

type Stored = { feishu?: FeishuConfig; imageAi?: ImageAiConfig };

const KEY = "secure-config";

export const MIN_ENCRYPTION_KEY_LENGTH = 32;

function legacyKey() {
  return createHash("sha256")
    .update(`${authSecretString()}:secure-config:v1`)
    .digest();
}

function currentKey() {
  const k = process.env.ENCRYPTION_KEY;
  return k ? Buffer.from(hkdfSync("sha256", k, "", "pm-collab:secure-config:v2", 32)) : null;
}

function encrypt(plain: string) {
  const v2 = currentKey();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", v2 ?? legacyKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return JSON.stringify({ v: 2, keyVersion: v2 ? 2 : 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: body.toString("base64") });
}

function decrypt(raw: string): string | null {
  try {
    const { iv, tag, data, keyVersion } = JSON.parse(raw) as { iv: string; tag: string; data: string; keyVersion?: number };
    const key = keyVersion === 2 ? currentKey() : legacyKey();
    if (!key) return null;
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    // 密钥变了或内容被改：当作未配置
    return null;
  }
}

/** 加密单个字段（如个人机器人 Webhook、签名密钥），存进数据库的只有密文 */
export function sealText(plain: string): string {
  return encrypt(plain);
}
/** 解密 sealText 的结果；密钥变化或内容损坏时返回 null */
export function openText(raw: string | null | undefined): string | null {
  return raw ? decrypt(raw) : null;
}

async function readRaw(): Promise<string | null> {
  const data = await storage().read("config", KEY);
  return data?.toString("utf8") ?? null;
}

async function writeRaw(raw: string) {
  await storage().write("config", KEY, Buffer.from(raw, "utf8"));
}

let cache: { at: number; value: Stored } | null = null;

async function readAll(): Promise<Stored> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  let value: Stored = {};
  try {
    const raw = await readRaw();
    const plain = raw ? decrypt(raw) : null;
    value = plain ? (JSON.parse(plain) as Stored) : {};
  } catch (e) {
    console.error("secure-config read failed", e);
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function getStoredFeishu(): Promise<FeishuConfig | null> {
  const f = (await readAll()).feishu;
  return f?.appId && f.appSecret ? f : null;
}

/** 保存飞书配置；appSecret 为空表示沿用已保存的值 */
export async function saveFeishu(input: { appId: string; appSecret?: string; redirectUri?: string; autoCreate?: boolean }, by: string) {
  const all = await readAll();
  const prev = all.feishu;
  const appSecret = input.appSecret || prev?.appSecret || "";
  const next: Stored = {
    ...all,
    feishu: {
      appId: input.appId,
      appSecret,
      redirectUri: input.redirectUri || undefined,
      autoCreate: input.autoCreate !== false,
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    },
  };
  await writeRaw(encrypt(JSON.stringify(next)));
  cache = { at: Date.now(), value: next };
}

export async function clearFeishu() {
  const all = await readAll();
  const next: Stored = { ...all, feishu: undefined };
  await writeRaw(encrypt(JSON.stringify(next)));
  cache = { at: Date.now(), value: next };
}

/** 掩码：cli_a1b2…9f0e */
export function mask(v: string | undefined | null) {
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(6)}${v.slice(-4)}`;
}

export async function getStoredImageAi(): Promise<ImageAiConfig | null> {
  const c = (await readAll()).imageAi;
  return c?.baseUrl && c.model && c.apiKey ? c : null;
}

/** 保存 AI 生图配置；apiKey 为空表示沿用已保存的值 */
export async function saveImageAi(input: { baseUrl: string; model: string; apiKey?: string; size?: string }, by: string) {
  const all = await readAll();
  const prev = all.imageAi;
  const next: Stored = {
    ...all,
    imageAi: {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey || prev?.apiKey || "",
      size: input.size || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    },
  };
  await writeRaw(encrypt(JSON.stringify(next)));
  cache = { at: Date.now(), value: next };
}

export async function clearImageAi() {
  const all = await readAll();
  const next: Stored = { ...all, imageAi: undefined };
  await writeRaw(encrypt(JSON.stringify(next)));
  cache = { at: Date.now(), value: next };
}
