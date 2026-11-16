import { createHash } from "crypto";
import { prisma } from "./prisma";

/**
 * proxy 用的会话校验（Node 运行时，不能用 next/headers）。
 * 页面和布局是并行渲染的，布局里的校验挡不住页面内容写进响应，
 * 所以页面的登录校验必须放在渲染之前，也就是 proxy 里。
 */
export async function checkPageSession(token: string): Promise<"ok" | "invalid" | "must-change"> {
  if (token.length > 100) return "invalid";
  const row = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    select: { expiresAt: true, revokedAt: true, user: { select: { isActive: true, mustChangePassword: true } } },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.user.isActive) return "invalid";
  // 被要求改密，或接受邀请 / 被重置后还没设置密码：只能先去设置密码
  return row.user.mustChangePassword ? "must-change" : "ok";
}

/** 演示站（GUEST_DEMO=1）才会调用：这个会话是不是只读的演示访客 */
export async function isDemoSession(token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const row = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    select: { user: { select: { isDemo: true } } },
  });
  return Boolean(row?.user.isDemo);
}

