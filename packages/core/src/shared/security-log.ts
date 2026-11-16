import { prisma } from "@pm-collab/db/prisma";

/** 安全事件写进活动日志（entityType=security），同时打到服务端日志便于告警。绝不记录密码、令牌 */
export async function securityLog(action: string, account: string, ip: string, actorId?: string | null, detail?: string) {
  console.warn(JSON.stringify({ type: "security", action, account, ip, at: new Date().toISOString() }));
  await prisma.activityLog
    .create({ data: { entityType: "security", entityId: account.slice(0, 120), action, actorId: actorId || null, message: `IP ${ip}${detail ? ` · ${detail}` : ""}` } })
    .catch(() => undefined);
}
