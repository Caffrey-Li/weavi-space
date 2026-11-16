import { randomBytes } from "crypto";
import { prisma } from "@pm-collab/db/prisma";
import { hashPassword, startSession } from "../auth";
import { hitIp } from "../shared/rate-limit";
import { result } from "../nova/result";

/**
 * 演示站「以访客身份体验」（GUEST_DEMO=1 才开启，默认关闭，真实部署不要开）：
 * 一键登录一个只读的演示访客账号（users.isDemo = true，角色 guest，数据范围「参与的项目」），
 * 自动加入演示企业的全部项目。写接口在 getSession 里统一拒绝。
 * 演示企业：GUEST_DEMO_ORG_CODE 指定企业编码，不填用排序第一的企业。会话 12 小时（不勾「保持登录」）。
 */
export const GUEST_EMAIL = "guest@demo.invalid";

export function guestDemoEnabled() {
  return process.env.GUEST_DEMO === "1";
}

export async function guestLogin(ip: string) {
  if (!guestDemoEnabled()) return result({ error: "没有开启访客体验" }, { status: 404 });
  const wait = hitIp(ip, "guest");
  if (wait) return result({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429 });
  const code = (process.env.GUEST_DEMO_ORG_CODE || "").trim();
  const org = await prisma.organization.findFirst({ where: { type: "enterprise", ...(code ? { code } : {}) }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!org) return result({ error: "演示企业还没有准备好，请联系管理员" }, { status: 503 });

  // 密码设成随机值（不会告诉任何人），避免被当成「没有密码的新账号」要求设置密码
  const existing = await prisma.user.findUnique({ where: { email: GUEST_EMAIL }, select: { id: true } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { isDemo: true, isActive: true, globalRole: "guest", orgId: org.id, mustChangePassword: false }, select: { id: true } })
    : await prisma.user.create({
        data: { email: GUEST_EMAIL, name: "访客", globalRole: "guest", isDemo: true, orgId: org.id, mustChangePassword: false, passwordHash: await hashPassword(randomBytes(24).toString("base64url")) },
        select: { id: true },
      });

  // 加入演示企业的全部项目（演示数据每天重置后会有新项目）
  const projects = await prisma.project.findMany({ where: { enterpriseId: org.id }, select: { id: true } });
  const joined = new Set((await prisma.projectMember.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((m) => m.projectId));
  const missing = projects.filter((p) => !joined.has(p.id));
  if (missing.length) await prisma.projectMember.createMany({ data: missing.map((p) => ({ projectId: p.id, userId: user.id, role: "member" })) });

  await startSession(user.id, false);
  return result({ ok: true });
}
