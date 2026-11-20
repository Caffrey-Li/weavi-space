import { prisma } from "@pm-collab/db/prisma";

/**
 * T34：记录一次 MCP 工具调用或开放接口 v1 请求（谁、用哪张令牌、调了什么、结果码）。不记参数和返回内容。
 * 写失败不影响调用本身；大约每 500 次顺带删掉 90 天前的记录。
 */
const KEEP_DAYS = 90;
let writes = 0;

/** v1 路径里的 id 换成 :id，便于按接口统计 */
export function v1Action(method: string, path: string[]) {
  const docs = path[0] === "docs";
  const named = new Set(["me", "docs", "spaces", "pages", "projects", "requirements", "bugs", "releases", "products", "members", "orgs", "reports", "progress", "comments", "status", "search"]);
  const parts = path.map((p, i) => (named.has(p) || (docs && i === 1) ? p : ":id"));
  return `${method} /${parts.join("/")}`.slice(0, 120);
}

export async function logApiAccess(entry: { enterpriseId?: string; userId: string; tokenId: string; channel: "mcp" | "v1"; action: string; status: number }) {
  if (!entry.tokenId || entry.tokenId === "in-process") return; // 系统内 Agent 用的是登录身份，不算对外取数
  try {
    await prisma.apiAccessLog.create({ data: { enterpriseId: entry.enterpriseId ?? "", userId: entry.userId, tokenId: entry.tokenId, channel: entry.channel, action: entry.action.slice(0, 120), status: entry.status } });
    if (++writes % 500 === 0) await prisma.apiAccessLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 864e5) } } });
  } catch {
    // 记录失败不影响调用
  }
}
