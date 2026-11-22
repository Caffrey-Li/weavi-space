import { prisma } from "@pm-collab/db/prisma";
import { level2OrgId, listOrgs } from "../shared/org";
import { isUnboundEmail } from "../shared/unbound-account";
import { sendMail, sendSmsCode } from "./channels";
import { maskPhone, normalizePhone, openPhone, phoneHash, sealPhone } from "./phone";
import { usableKinds } from "./providers";
import { createBindCode, verifyBindCode } from "./tokens";

/**
 * 本人绑定邮箱 / 手机号（邀请码登录的账号必须先绑一个才能设置密码）：
 * - 只能绑还没绑的那一项（已绑定的邮箱 / 手机号由管理员在成员管理里改）；
 * - 本企业（没有企业就系统级）开通了邮箱 / 短信验证码时，要先收验证码确认；没开通直接绑定；
 * - 不能和别人的账号重复。
 */

type Channel = "email" | "sms";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function channelsFor(orgId: string | null) {
  const scope = level2OrgId(await listOrgs(), orgId) || "";
  const kinds = await usableKinds(scope);
  return { email: kinds.includes("email"), sms: kinds.includes("sms") };
}

export async function bindStatus(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phoneEnc: true, phoneHash: true, orgId: true } });
  if (!u) return null;
  const email = isUnboundEmail(u.email) ? null : u.email;
  const phone = u.phoneHash ? maskPhone(openPhone(u.phoneEnc)) || "已绑定" : null;
  return { email, phone, needsBind: !email && !phone, verify: await channelsFor(u.orgId) };
}

/** 校验要绑定的地址；返回规范化后的值或错误 */
async function checkTarget(userId: string, channel: Channel, raw: unknown) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phoneHash: true, orgId: true } });
  if (!u) return { error: "账号不存在", status: 404 } as const;
  if (channel === "email") {
    if (!isUnboundEmail(u.email)) return { error: "已经绑定了邮箱，如需更换请联系管理员", status: 400 } as const;
    const email = String(raw ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200 || isUnboundEmail(email)) return { error: "邮箱格式不对", status: 400 } as const;
    if (await prisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } })) return { error: "这个邮箱已被其他账号使用", status: 400 } as const;
    return { user: u, value: email } as const;
  }
  if (u.phoneHash) return { error: "已经绑定了手机号，如需更换请联系管理员", status: 400 } as const;
  const phone = normalizePhone(raw);
  if (!phone) return { error: "手机号格式不对", status: 400 } as const;
  if (await prisma.user.findFirst({ where: { phoneHash: phoneHash(phone), NOT: { id: userId } }, select: { id: true } })) return { error: "这个手机号已被其他账号使用", status: 400 } as const;
  return { user: u, value: phone } as const;
}

/** 发验证码（只有开通了对应通道才需要） */
export async function sendBindCode(userId: string, channelRaw: unknown, target: unknown) {
  const channel: Channel | null = channelRaw === "sms" ? "sms" : channelRaw === "email" ? "email" : null;
  if (!channel) return { error: "请选择邮箱或手机号", status: 400 } as const;
  const c = await checkTarget(userId, channel, target);
  if ("error" in c) return c;
  if (!(await channelsFor(c.user.orgId))[channel]) return { error: "没有开通验证码，直接绑定即可", status: 400 } as const;
  const code = await createBindCode(userId, channel, c.value);
  if (!code) return { error: "验证码发送太频繁，请 1 分钟后再试", status: 429 } as const;
  try {
    const ok = channel === "email" ? await sendMail(c.value, "小围空间绑定验证码", `你的绑定验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略。`) : await sendSmsCode(c.value, code);
    if (!ok) return { error: "验证码发送失败，请稍后再试或联系管理员", status: 502 } as const;
  } catch (e) {
    console.error("send bind code failed", e);
    return { error: "验证码发送失败，请稍后再试或联系管理员", status: 502 } as const;
  }
  return { ok: true as const, message: "验证码已发送，10 分钟内有效" };
}

/** 绑定；绑定邮箱会替换占位邮箱，现有会话不受影响 */
export async function bindAccount(userId: string, channelRaw: unknown, target: unknown, code: unknown) {
  const channel: Channel | null = channelRaw === "sms" ? "sms" : channelRaw === "email" ? "email" : null;
  if (!channel) return { error: "请选择邮箱或手机号", status: 400 } as const;
  const c = await checkTarget(userId, channel, target);
  if ("error" in c) return c;
  if ((await channelsFor(c.user.orgId))[channel] && !(await verifyBindCode(userId, channel, c.value, String(code ?? "")))) {
    return { error: "验证码错误或已过期", status: 400 } as const;
  }
  try {
    await prisma.user.update({ where: { id: userId }, data: channel === "email" ? { email: c.value } : sealPhone(c.value) });
  } catch {
    // 并发下被别人抢先占用（唯一索引）
    return { error: channel === "email" ? "这个邮箱已被其他账号使用" : "这个手机号已被其他账号使用", status: 400 } as const;
  }
  await prisma.activityLog.create({ data: { entityType: "user", entityId: userId, action: "account_bound", actorId: userId, toValue: JSON.stringify({ channel }) } });
  return { ok: true as const, account: await bindStatus(userId) };
}
