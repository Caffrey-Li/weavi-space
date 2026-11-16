/**
 * 清库 / 写入测试账号前的保护：线上环境直接拒绝。
 * 拒绝的情况：NODE_ENV=production、配置了 TURSO_DATABASE_URL、DATABASE_URL 不是本机 PostgreSQL，
 * 或库名里没有 local / demo / test / verify / e2e / smoke（真实数据的本地库叫 pm_collab，不带这些词，所以会被拒绝）。
 * 确实要在这类环境执行时，显式设置 ALLOW_DESTRUCTIVE_SEED=yes。
 *
 * 用法：import 后调用 assertSafeToWipe("说明")；也可以直接 `tsx prisma/guard-destructive.ts` 作为前置检查。
 */
import "dotenv/config";

export function assertSafeToWipe(what: string) {
  const url = process.env.DATABASE_URL || "";
  const reasons: string[] = [];
  if (process.env.NODE_ENV === "production") reasons.push("NODE_ENV=production");
  if (process.env.TURSO_DATABASE_URL) reasons.push("配置了 TURSO_DATABASE_URL（线上库）");
  let host = "";
  let name = "";
  try {
    const u = new URL(url);
    if (u.protocol === "postgresql:" || u.protocol === "postgres:") {
      host = u.hostname;
      name = decodeURIComponent(u.pathname.replace(/^\//, ""));
    }
  } catch {
    /* 下面按「不是 PostgreSQL」处理 */
  }
  if (!name) reasons.push("DATABASE_URL 不是 PostgreSQL 连接串");
  else {
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) reasons.push(`数据库不在本机（${host}）`);
    if (!/(local|demo|test|verify|e2e|smoke)/i.test(name)) reasons.push(`库名「${name}」不像测试库（要带 local / demo / test 等字样，真实数据库 pm_collab 不允许）`);
  }
  if (reasons.length && process.env.ALLOW_DESTRUCTIVE_SEED !== "yes") {
    console.error(`已拒绝执行「${what}」：${reasons.join("；")}。\n确认要执行时请设置 ALLOW_DESTRUCTIVE_SEED=yes。`);
    process.exit(1);
  }
}

if (require.main === module) assertSafeToWipe(process.argv[2] || "清库");
