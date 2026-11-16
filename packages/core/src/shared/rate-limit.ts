/**
 * 登录限流（进程内存）：
 * - 每个 IP：15 分钟内最多 60 次认证请求（公司出口共用一个 IP 时也够用）；
 * - 同一 IP + 账号：连续失败 5 次锁定 15 分钟；
 * - 同一账号（不分 IP）：15 分钟内失败 20 次锁定 15 分钟，防止换 IP 撞库。
 *   分成两层是因为只按账号锁时，别人故意输错 5 次就能把受害者锁在外面。
 * 登录成功清零。只有一个服务进程时有效；多实例部署需要换成 Redis 等共享存储（接口不变）。
 */
import { CLIENT_IP_HEADER, trustNetlifyIp } from "./client-ip";

const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 60;
const PAIR_FAIL_LIMIT = 5;
const ACCOUNT_FAIL_LIMIT = 20;
export const LOCK_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };
type Fails = { count: number; first: number; lockedUntil: number };

const g = globalThis as unknown as { __pmIpBuckets?: Map<string, Bucket>; __pmAccountFails?: Map<string, Fails> };
const ipBuckets: Map<string, Bucket> = (g.__pmIpBuckets ||= new Map<string, Bucket>());
const accountFails: Map<string, Fails> = (g.__pmAccountFails ||= new Map<string, Fails>());

function sweep(now: number) {
  if (ipBuckets.size > 5000) ipBuckets.forEach((b, k) => b.resetAt < now && ipBuckets.delete(k));
  if (accountFails.size > 5000) accountFails.forEach((f, k) => f.lockedUntil < now && f.first + WINDOW_MS < now && accountFails.delete(k));
}

/** 记一次来自该 IP 的认证请求；超限返回需等待的秒数。取不到真实 IP 时不计（否则所有人共用一个桶，互相锁死） */
export function hitIp(ip: string, scope = "login", now = Date.now()): number | null {
  if (ip === "unknown") return null;
  sweep(now);
  const key = `${scope}:${ip}`;
  const b = ipBuckets.get(key);
  if (!b || b.resetAt < now) {
    ipBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  b.count += 1;
  return b.count > IP_LIMIT ? Math.ceil((b.resetAt - now) / 1000) : null;
}

const pairKey = (account: string, ip: string) => `${ip}|${account}`;

function bump(key: string, limit: number, now: number): boolean {
  const f = accountFails.get(key);
  if (!f || f.first + WINDOW_MS < now) {
    accountFails.set(key, { count: 1, first: now, lockedUntil: 0 });
    return limit <= 1;
  }
  f.count += 1;
  if (f.count >= limit) {
    f.lockedUntil = now + LOCK_MS;
    f.count = 0;
    f.first = now;
    return true;
  }
  return false;
}

/** 是否处于锁定中；是则返回剩余秒数 */
export function accountLocked(account: string, ip: string, now = Date.now()): number | null {
  const until = Math.max(accountFails.get(pairKey(account, ip))?.lockedUntil ?? 0, accountFails.get(account)?.lockedUntil ?? 0);
  return until > now ? Math.ceil((until - now) / 1000) : null;
}

/** 记一次失败；达到上限时锁定并返回 true */
export function recordFailure(account: string, ip: string, now = Date.now()): boolean {
  const pair = bump(pairKey(account, ip), PAIR_FAIL_LIMIT, now);
  const all = bump(account, ACCOUNT_FAIL_LIMIT, now);
  return pair || all;
}

export function clearFailures(account: string, ip: string) {
  accountFails.delete(pairKey(account, ip));
  accountFails.delete(account);
}

/**
 * 取客户端 IP。X-Forwarded-For 客户端可以随便写，只有声明了前面有可信代理时才用：
 * TRUST_PROXY=1 时取最后一个（那是最近一层代理追加的真实来源）；Netlify 见 client-ip.ts。
 */
export function clientIp(headers: Headers) {
  if (trustNetlifyIp()) return headers.get(CLIENT_IP_HEADER) || "unknown";
  if (process.env.TRUST_PROXY === "1") {
    const list = (headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return list[list.length - 1] || headers.get("x-real-ip") || "unknown";
  }
  return "unknown";
}
