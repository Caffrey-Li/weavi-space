import { prisma } from "@pm-collab/db/prisma";
import { revokeUserSessions } from "../auth";
import { createInviteCode, createLinkToken } from "./tokens";
import { formatInviteCode, isUnboundEmail } from "../shared/unbound-account";
import { sendMail } from "./channels";

/** 站点地址：优先 APP_URL，其次请求的域名（链接要发给别人，不能是 localhost 以外的猜测） */
export function publicOrigin(reqUrl: string, headers?: Headers) {
  const site = process.env.APP_URL || process.env.URL;
  if (site) return new URL(site).origin;
  const host = headers?.get("x-forwarded-host") || headers?.get("host");
  const proto = headers?.get("x-forwarded-proto") || new URL(reqUrl).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(reqUrl).origin;
}

/** 生成邀请码和带码的链接，填了邮箱就尽量发邮件；返回给管理员复制（只出现在这次响应里） */
export async function issueInvite(user: { id: string; name: string; email: string }, by: string, origin: string) {
  const raw = await createInviteCode(user.id, by);
  const code = formatInviteCode(raw);
  const link = `${origin}/login?invite=${raw}`;
  let emailed = false;
  if (user.email.includes("@") && !isUnboundEmail(user.email)) {
    emailed = await sendMail(user.email, "邀请你加入小围空间", `${user.name}，你好：\n\n你被邀请加入小围空间。邀请码：${code}（7 天内有效，只能用一次）\n\n打开下面的链接，或在登录页选「邀请登录」输入邀请码即可登录；首次登录需要设置密码：\n\n${link}\n`).catch((e) => {
      console.error("invite mail failed", e);
      return false;
    });
  }
  await prisma.activityLog.create({ data: { entityType: "user", entityId: user.id, action: "invite_issued", actorId: by, toValue: JSON.stringify({ emailed }) } });
  return { link, code, emailed };
}

/**
 * 管理员重置密码：旧密码立即作废、所有会话下线，生成 24 小时有效的重置链接。
 * 用户也可以直接用已绑定的飞书 / 企业微信 / 钉钉或验证码登录，登录后必须设置新密码。
 */
export async function issueReset(user: { id: string; name: string; email: string }, by: string, origin: string) {
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null, mustChangePassword: true } });
  await revokeUserSessions(user.id);
  const raw = await createLinkToken(user.id, "reset", by);
  const link = `${origin}/login?invite=${raw}`;
  let emailed = false;
  if (user.email.includes("@") && !isUnboundEmail(user.email)) {
    emailed = await sendMail(user.email, "小围空间密码已重置", `${user.name}，你好：\n\n管理员重置了你的密码，旧密码已失效。打开下面的链接，核对邮箱后登录并设置新密码（24 小时内有效）；也可以用已绑定的飞书 / 企业微信 / 钉钉登录：\n\n${link}\n`).catch((e) => {
      console.error("reset mail failed", e);
      return false;
    });
  }
  await prisma.activityLog.create({ data: { entityType: "user", entityId: user.id, action: "password_reset_issued", actorId: by, toValue: JSON.stringify({ emailed }) } });
  return { link, emailed };
}
