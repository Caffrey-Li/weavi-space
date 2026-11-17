import { prisma } from "@pm-collab/db/prisma";
import { startSession } from "../auth";
import { hitIp } from "../shared/rate-limit";
import { result } from "../nova/result";
import { demoOrgId, joinDemoProjects } from "../demo/service";
import { oneClickOn } from "../demo/guests";

/**
 * 登录页「以访客身份体验」：系统超管在「演示体验」里开启（system_settings.demoOneClick），
 * 或旧的环境变量 GUEST_DEMO=1（单独部署的演示站）。一键登录一个只读的共享访客账号
 * （users.isDemo = true，demoKind = oneclick，角色 guest），自动加入演示企业的全部项目；写接口统一拒绝。
 * 演示企业：有演示组织时用它；否则（只有 GUEST_DEMO=1 时）用 GUEST_DEMO_ORG_CODE 指定的企业或排序第一的企业。会话 12 小时。
 */
export const GUEST_EMAIL = "guest@demo.invalid";

export async function guestDemoEnabled() {
  return process.env.GUEST_DEMO === "1" || (await oneClickOn());
}

export async function guestLogin(ip: string) {
  if (!(await guestDemoEnabled())) return result({ error: "没有开启访客体验" }, { status: 404 });
  const wait = hitIp(ip, "guest");
  if (wait) return result({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429 });
  let orgId = await demoOrgId();
  if (!orgId) {
    const code = (process.env.GUEST_DEMO_ORG_CODE || "").trim();
    const org = await prisma.organization.findFirst({ where: { type: "enterprise", ...(code ? { code } : {}) }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    orgId = org?.id ?? null;
  }
  if (!orgId) return result({ error: "演示企业还没有准备好，请联系管理员" }, { status: 503 });

  // 没有密码、不强制改密：只能通过一键体验登录
  const data = { isDemo: true, isActive: true, globalRole: "guest", position: "pm", demoKind: "oneclick", demoExpiresAt: null, orgId, mustChangePassword: false };
  const user = await prisma.user.upsert({ where: { email: GUEST_EMAIL }, create: { email: GUEST_EMAIL, name: "访客", passwordHash: null, ...data }, update: data, select: { id: true } });

  // 加入演示企业的全部项目（演示数据重置后会有新项目）
  await joinDemoProjects(orgId, [user.id]);
  await startSession(user.id, false);
  return result({ ok: true });
}
