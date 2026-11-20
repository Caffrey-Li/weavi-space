import type { SessionUser } from "../auth";
import { revokeUserSessions } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { roleFitsEnterprise, validPosition, validRole } from "../shared/roles";
import { canAssignRole, userScope } from "../shared/admin-gate";
import { enterpriseAdminOf, enterpriseAuthority } from "../shared/enterprise-admin";
import { SYSTEM_ORG_ID, canManageUser, ensureSystemOrg, level2OrgId, listOrgs } from "../shared/org";
import { issueInvite, issueReset } from "../login/links";
import { maskPhone, normalizePhone, openPhone, sealPhone } from "../login/phone";
import { result } from "./result";

/** 动态里记下账号变更（绝不记密码本身） */
function logUser(actorId: string, entityId: string, action: string, toValue: unknown) {
  return prisma.activityLog.create({ data: { entityType: "user", entityId, action, actorId, toValue: JSON.stringify(toValue) } });
}

/** 校验所属组织；空值归到系统组织 */
async function resolveOrgId(raw: unknown): Promise<string | null | undefined> {
  if (raw === undefined) return undefined;
  const id = String(raw || "") || SYSTEM_ORG_ID;
  if (id === SYSTEM_ORG_ID) {
    await ensureSystemOrg();
    return id;
  }
  const org = await prisma.organization.findUnique({ where: { id } });
  return org ? id : null;
}

/** Normalize login account: trim; if looks like email (contains @) then lower-case. */
function normalizeAccount(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

/** Case-insensitive uniqueness lookup against User.email column. */
async function findUserByAccount(account: string, excludeId?: string) {
  const lower = account.toLowerCase();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = ${lower} LIMIT 5
  `;
  for (const row of rows) {
    if (row.id !== excludeId) {
      return prisma.user.findUnique({ where: { id: row.id } });
    }
  }
  return null;
}

export async function GET(session: SessionUser) {
  // 管理者只看得到自己的管理范围和自己
  const scope = await userScope(session);
  const users = await prisma.user.findMany({
    where: scope ? { OR: [{ orgId: { in: Array.from(scope) } }, { id: session.id }] } : {},
    select: {
      id: true,
      email: true,
      name: true,
      globalRole: true,
      position: true,
      isActive: true,
      mustChangePassword: true,
      orgId: true,
      createdAt: true,
      phoneEnc: true,
      passwordHash: true,
    },
    orderBy: { name: "asc" },
  });
  // 手机号只给脱敏值；密码只告诉是否已设置（待激活）
  return result({ users: users.map(({ phoneEnc, passwordHash, ...u }) => ({ ...u, phone: maskPhone(openPhone(phoneEnc)), pending: !passwordHash })) });
}

/**
 * 新建账号 = 邀请：管理员不设密码，生成 7 天有效的邀请链接（配置了邮件时同时发邮件）。
 * 被邀请人打开链接、核对邮箱或手机号即可登录，首次登录必须设置密码。
 */
export async function POST(session: SessionUser, body: Record<string, unknown>, origin = "") {
  const name = String(body.name || "").trim().slice(0, 40);
  const account = normalizeAccount((body.account ?? body.email ?? "") as string);
  const globalRole = String(body.globalRole || "member");
  const position = String(body.position || "");
  if (!name || !account) {
    return result({ error: "姓名、账号（邮箱）必填" }, { status: 400 });
  }
  if (body.password !== undefined && body.password !== "") {
    return result({ error: "管理员不能设置账号密码，请用邀请链接，由本人首次登录时设置" }, { status: 400 });
  }
  const phoneRaw = String(body.phone || "").trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return result({ error: "手机号格式不对" }, { status: 400 });
  if (!(await validRole(globalRole))) return result({ error: "角色不存在" }, { status: 400 });
  if (!(await canAssignRole(session, globalRole))) {
    return result({ error: "只能授予比自己级别低的角色" }, { status: 403 });
  }
  if (!(await validPosition(position))) return result({ error: "岗位不存在" }, { status: 400 });
  const orgId = await resolveOrgId(body.orgId ?? "");
  if (!orgId) return result({ error: "所属组织不存在" }, { status: 400 });
  const scope = await userScope(session);
  if (scope && !scope.has(orgId)) return result({ error: "只能把账号放在自己管理的组织里" }, { status: 403 });
  // T37 企业角色只能给本企业的人（别的企业的角色按不存在）
  if (!(await roleFitsEnterprise(globalRole, level2OrgId(await listOrgs(), orgId) || ""))) return result({ error: "角色不存在" }, { status: 400 });
  const existing = await findUserByAccount(account);
  if (existing) return result({ error: "账号已存在" }, { status: 400 });
  const sealed = phone ? sealPhone(phone) : null;
  if (sealed && (await prisma.user.findUnique({ where: { phoneHash: sealed.phoneHash } }))) return result({ error: "手机号已被其他账号使用" }, { status: 400 });
  const user = await prisma.user.create({
    data: {
      name,
      email: account,
      passwordHash: null,
      ...(sealed || {}),
      globalRole,
      position: position || null,
      isActive: true,
      mustChangePassword: true,
      orgId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      globalRole: true,
      position: true,
      isActive: true,
      mustChangePassword: true,
      orgId: true,
    },
  });
  await logUser(session.id, user.id, "created", { email: user.email, globalRole, orgId, phone: phone ? maskPhone(phone) : undefined });
  const invite = await issueInvite(user, session.id, origin);
  return result({ user, inviteLink: invite.link, emailed: invite.emailed });
}

export async function PATCH(session: SessionUser, body: Record<string, unknown>, origin = "") {
  // Intentionally do NOT touch the admin session cookie here.
  const id = String(body.id || "");
  if (!id) return result({ error: "缺少用户 id" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return result({ error: "用户不存在" }, { status: 404 });
  // 账号管理权限不等于超管：只能动本二级组织内级别比自己低的账号（改密码等于接管）。本人资料走 /api/auth/profile
  const scope = await userScope(session);
  const authority = await enterpriseAuthority(session, user);
  if (authority === "deny") return result({ error: "企业超级管理员的账号只能由 Weavi Space 系统超管处理" }, { status: 403 });
  if (authority !== "allow" && !canManageUser(session.globalRole, scope, user)) {
    return result({ error: "只能修改自己管理的组织里级别比自己低的账号" }, { status: 403 });
  }
  // 系统超管改企业超管：角色、启停用、移出本企业都要先在 Weavi Space 后台换超管
  const adminOf = await enterpriseAdminOf(user.id);
  if (adminOf) {
    const roleChange = typeof body.globalRole === "string" && body.globalRole !== user.globalRole;
    const deactivate = body.isActive === false;
    const leaving = body.orgId !== undefined && level2OrgId(await listOrgs(), String(body.orgId || "") || SYSTEM_ORG_ID) !== adminOf;
    if (roleChange || deactivate || leaving) {
      return result({ error: "这个账号是企业超级管理员，请先在 Weavi Space 后台更换企业超管，再改角色、停用或移出企业" }, { status: 400 });
    }
  }

  const data: {
    name?: string;
    email?: string;
    globalRole?: string;
    position?: string | null;
    isActive?: boolean;
    mustChangePassword?: boolean;
    orgId?: string;
    phoneEnc?: string | null;
    phoneHash?: string | null;
  } = {};
  if (body.password !== undefined && body.password !== "") {
    return result({ error: "管理员不能设置账号密码，请用「重置密码」生成重置链接" }, { status: 400 });
  }
  if (body.phone !== undefined) {
    const raw = String(body.phone || "").trim();
    if (!raw) {
      data.phoneEnc = null;
      data.phoneHash = null;
    } else {
      const phone = normalizePhone(raw);
      if (!phone) return result({ error: "手机号格式不对" }, { status: 400 });
      const sealed = sealPhone(phone);
      const clash = await prisma.user.findUnique({ where: { phoneHash: sealed.phoneHash } });
      if (clash && clash.id !== id) return result({ error: "手机号已被其他账号使用" }, { status: 400 });
      if (sealed.phoneHash !== user.phoneHash) Object.assign(data, sealed);
    }
  }

  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 40);
    if (!name) return result({ error: "姓名不能为空" }, { status: 400 });
    data.name = name;
  }

  const accountRaw = body.account ?? body.email;
  if (typeof accountRaw === "string" && accountRaw.trim()) {
    const account = normalizeAccount(accountRaw);
    if (!account) return result({ error: "账号不能为空" }, { status: 400 });
    if (account !== user.email) {
      const clash = await findUserByAccount(account, id);
      if (clash) return result({ error: "账号已存在" }, { status: 400 });
      data.email = account;
    }
  }

  if (typeof body.globalRole === "string") {
    if (!(await validRole(body.globalRole))) return result({ error: "角色不存在" }, { status: 400 });
    if (id === session.id && user.globalRole === "admin" && body.globalRole !== "admin") {
      return result({ error: "不能取消自己的系统管理员角色" }, { status: 400 });
    }
    if (body.globalRole !== user.globalRole && !(await canAssignRole(session, body.globalRole))) {
      return result({ error: "只能授予比自己级别低的角色" }, { status: 403 });
    }
    data.globalRole = body.globalRole;
  }
  if (body.position !== undefined) {
    const position = String(body.position || "");
    if (!(await validPosition(position))) return result({ error: "岗位不存在" }, { status: 400 });
    data.position = position || null;
  }
  if (body.orgId !== undefined) {
    const orgId = await resolveOrgId(body.orgId);
    if (!orgId) return result({ error: "所属组织不存在" }, { status: 400 });
    if (scope && !scope.has(orgId)) return result({ error: "只能把账号放在自己管理的组织里" }, { status: 403 });
    data.orgId = orgId;
  }
  if (typeof body.isActive === "boolean") {
    if (!body.isActive && id === session.id) {
      return result({ error: "不能停用自己的账号" }, { status: 400 });
    }
    data.isActive = body.isActive;
  }
  if (data.globalRole !== undefined || data.orgId !== undefined) {
    const finalOrg = data.orgId ?? user.orgId ?? SYSTEM_ORG_ID;
    if (!(await roleFitsEnterprise(data.globalRole ?? user.globalRole, level2OrgId(await listOrgs(), finalOrg) || ""))) {
      return result({ error: data.globalRole !== undefined && data.globalRole !== user.globalRole ? "角色不存在" : "这个人用的是原企业自建的角色，换企业前请先把角色改成通用角色或新企业的角色" }, { status: 400 });
    }
  }
  const resetPassword = body.resetPassword === true;
  if (Object.keys(data).length === 0 && !resetPassword) {
    return result({ error: "无更新字段" }, { status: 400 });
  }
  const updated = await prisma.user.update({
    where: { id },
    data: Object.keys(data).length ? data : { updatedAt: new Date() },
    select: {
      id: true,
      email: true,
      name: true,
      globalRole: true,
      position: true,
      isActive: true,
      mustChangePassword: true,
      orgId: true,
    },
  });

  // 角色、默认岗位都不改动已有的项目内岗位（项目内岗位在项目成员里单独调整）

  // 停用、改角色、改账号、重置密码：这个人已有的会话全部作废，下次请求就要重新登录
  const roleChanged = data.globalRole !== undefined && data.globalRole !== user.globalRole;
  const accountChanged = data.email !== undefined;
  const deactivated = data.isActive === false && user.isActive;
  if (roleChanged || accountChanged || deactivated) await revokeUserSessions(id);
  await logUser(session.id, id, "account_updated", { ...data, phoneEnc: undefined, phoneHash: undefined, phoneChanged: data.phoneHash !== undefined ? true : undefined, passwordReset: resetPassword || undefined });
  // 重置密码：旧密码作废、会话下线，返回一次性重置链接（管理员看不到也设不了密码）
  const reset = resetPassword ? await issueReset(updated, session.id, origin) : null;

  // Admin session cookie is never cleared or rewritten when resetting another user.
  return result({ user: updated, ...(reset ? { resetLink: reset.link, emailed: reset.emailed } : {}) });
}

/** 删除账号：只能删没有留下业务记录的账号；有记录的请停用，保留历史归属 */
export async function DELETE(session: SessionUser, requestUrl: string) {
  const id = new URL(requestUrl).searchParams.get("id") || "";
  if (!id) return result({ error: "缺少用户 id" }, { status: 400 });
  if (id === session.id) return result({ error: "不能删除自己的账号" }, { status: 400 });
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      globalRole: true,
      orgId: true,
      _count: { select: { createdRequirements: true, createdBugs: true, docPagesCreated: true } },
    },
  });
  if (!user) return result({ error: "用户不存在" }, { status: 404 });
  const authority = await enterpriseAuthority(session, user);
  if (authority === "deny") return result({ error: "企业超级管理员的账号只能由 Weavi Space 系统超管处理" }, { status: 403 });
  if (authority !== "allow" && !canManageUser(session.globalRole, await userScope(session), user)) {
    return result({ error: "只能删除自己管理的组织里级别比自己低的账号" }, { status: 403 });
  }
  if (await enterpriseAdminOf(user.id)) {
    return result({ error: "这个账号是企业超级管理员，请先在 Weavi Space 后台更换企业超管" }, { status: 400 });
  }
  const c = user._count;
  if (c.createdRequirements || c.createdBugs || c.docPagesCreated) {
    const parts = [
      c.createdRequirements ? `${c.createdRequirements} 条需求` : "",
      c.createdBugs ? `${c.createdBugs} 个 Bug` : "",
      c.docPagesCreated ? `${c.docPagesCreated} 篇文档` : "",
    ].filter(Boolean);
    return result(
      { error: `${user.name} 创建过 ${parts.join("、")}，不能删除，可以改为停用账号` },
      { status: 400 },
    );
  }
  await prisma.user.delete({ where: { id } });
  await prisma.activityLog.create({
    data: {
      entityType: "user",
      entityId: id,
      action: "deleted",
      actorId: session.id,
      fromValue: JSON.stringify({ name: user.name, email: user.email }),
    },
  });
  return result({ ok: true });
}
