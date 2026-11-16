/** 产品环境地址：每个产品可以有多个环境，每个环境多个地址（前后端共用） */
export const ENV_NETWORKS = [
  { key: "external", label: "外网", tone: "is-success" },
  { key: "internal", label: "内网", tone: "is-warning" },
] as const;
export type EnvNetwork = (typeof ENV_NETWORKS)[number]["key"];
export type ProductEnvUrl = { label: string; url: string; network: EnvNetwork; note: string };
export type ProductEnv = { name: string; urls: ProductEnvUrl[] };

export const ENV_PRESETS = ["生产", "预发", "测试", "开发"];
const MAX_ENVS = 10;
const MAX_URLS = 10;

/** 没写协议的地址补 https://；不是 http(s) 的返回空串 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().replace(/\/$/, withScheme.endsWith("/") ? "/" : "") : "";
  } catch {
    return "";
  }
}

/** 清洗：去掉空环境、空地址；地址不合法时报错（返回 error） */
export function cleanEnvs(input: unknown): { envs: ProductEnv[]; error?: string } {
  const list = Array.isArray(input) ? input : [];
  const envs: ProductEnv[] = [];
  for (const e of list.slice(0, MAX_ENVS)) {
    const env = (e || {}) as { name?: unknown; urls?: unknown };
    const name = String(env.name ?? "").trim().slice(0, 20);
    const urls: ProductEnvUrl[] = [];
    for (const u of (Array.isArray(env.urls) ? env.urls : []).slice(0, MAX_URLS)) {
      const item = (u || {}) as { label?: unknown; url?: unknown; network?: unknown; note?: unknown };
      const raw = String(item.url ?? "").trim();
      const label = String(item.label ?? "").trim().slice(0, 30);
      if (!raw) continue;
      const url = normalizeUrl(raw);
      if (!url) return { envs: [], error: `「${name || "环境"}」的地址「${raw}」不是有效的 http / https 地址` };
      urls.push({
        label: label || "地址",
        url,
        // 11-04 之前存的地址没有网络类型，按外网显示
        network: item.network === "internal" ? "internal" : "external",
        note: String(item.note ?? "").trim().slice(0, 100),
      });
    }
    if (!name && !urls.length) continue;
    if (!name) return { envs: [], error: "请填写环境名称" };
    if (envs.some((x) => x.name === name)) return { envs: [], error: `环境「${name}」重复了` };
    envs.push({ name, urls });
  }
  return { envs };
}

export function parseEnvs(raw: string | null | undefined): ProductEnv[] {
  try {
    return cleanEnvs(JSON.parse(raw || "[]")).envs;
  } catch {
    return [];
  }
}
