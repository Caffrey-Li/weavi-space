import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

/**
 * AUTH_SECRET：现在只用来派生旧版配置加密密钥（见 secure-config.ts），会话已改成服务端存储，不再靠它签名。
 * 生产环境（NODE_ENV=production）必须配置不少于 32 位，否则拒绝启动，绝不退回默认值；
 * 开发环境没配时生成随机密钥存到 .data/dev-auth-secret（已被 .gitignore 忽略）并打印警告。
 * 只能在 Node 运行时使用（用到文件系统），中间件不要引入。
 */
export const MIN_SECRET_LENGTH = 32;

export function authSecretProblem(): string | null {
  const s = process.env.AUTH_SECRET || "";
  if (!s) return "没有配置 AUTH_SECRET";
  if (s === "dev-secret") return "AUTH_SECRET 仍是开发默认值";
  if (s.length < MIN_SECRET_LENGTH) return `AUTH_SECRET 不足 ${MIN_SECRET_LENGTH} 位`;
  return null;
}

let devSecret: string | null = null;

function loadDevSecret() {
  if (devSecret) return devSecret;
  const file = path.join(process.cwd(), ".data", "dev-auth-secret");
  try {
    devSecret = readFileSync(file, "utf8").trim() || null;
  } catch {
    devSecret = null;
  }
  if (!devSecret) {
    devSecret = randomBytes(48).toString("base64url");
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, devSecret, { mode: 0o600 });
    } catch {
      /* 目录只读：只在本次进程内有效 */
    }
    console.warn("[安全] 没有配置合格的 AUTH_SECRET，已生成本地开发密钥写入 .data/dev-auth-secret；生产环境必须在环境变量里配置。");
  }
  return devSecret;
}

export function authSecretString(): string {
  const problem = authSecretProblem();
  if (!problem) return process.env.AUTH_SECRET as string;
  if (process.env.NODE_ENV === "production") throw new Error(`${problem}，生产环境拒绝使用`);
  return loadDevSecret();
}
