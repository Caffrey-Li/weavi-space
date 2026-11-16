import type { SessionUser } from "../auth";
import { revokeUserSessions } from "../auth";
import { issueInvite } from "../login/links";
import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { SYSTEM_ORG_ID, ensureSystemOrg, level2OrgId, listOrgs, subtreeIds } from "../shared/org";
import { ENTERPRISE_CODE_RE, normalizeEnterpriseCode } from "../shared/enterprise-admin";
import { result } from "./result";

/**
 * Weavi Space 系统后台 · 企业管理（只有系统超管）：
 * 企业的名称、编码（专属登录链接 /login?org=<code>）、唯一的企业超级管理员。
 * 部门的增删和删除企业仍在「组织架构」页。
 */

const MANAGER_ROLE = "manager";
const deny = () => result({ error: "只有 Weavi Space 系统超管可以管理企业" }, { status: 403 });

function logOrg(actorId: string, entityId: string, action: string, toValue: unknown, fromValue?: unknown) {
  return prisma.activityLog.create({
    data: { entityType: "org", entityId, action, actorId, toValue: JSON.stringify(toValue), ...(fromValue === undefined ? {} : { fromValue: JSON.stringify(fromValue) }) },
  });
}

export async function GET(session: SessionUser) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  return result({ enterprises: await listEnterprises() });
}

export async function listEnterprises() {
  const orgs = await listOrgs();
  const rows = await prisma.organization.findMany({
    where: { type: "enterprise" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, code: true, createdAt: true, admin: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  const [users, projects] = await Promise.all([
    prisma.user.findMany({ where: { orgId: { not: null } }, select: { orgId: true } }),
    prisma.project.groupBy({ by: ["enterpriseId"], where: { enterpriseId: { not: null } }, _count: { _all: true } }),
  ]);
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    code: e.code,
    createdAt: e.createdAt.toISOString(),
    admin: e.admin,
    memberCount: users.filter((u) => level2OrgId(orgs, u.orgId) === e.id).length,
    projectCount: projects.find((p) => p.enterpriseId === e.id)?._count._all || 0,
  }));
}

async function checkCode(raw: unknown, exceptId?: string): Promise<{ code: string | null } | { error: string }> {
  const code = normalizeEnterpriseCode(raw);
  if (!code) return { code: null };
  if (!ENTERPRISE_CODE_RE.test(code)) return { error: "企业编码只能用小写字母开头，包含小写字母、数字、短横线，2～32 位" };
  const clash = await prisma.organization.findFirst({ where: { code, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  return clash ? { error: "企业编码已被使用" } : { code };
}

/** 新建企业：{ name, code } */
export async function POST(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const name = String(body.name || "").trim();
  if (!name) return result({ error: "请填写企业名称" }, { status: 400 });
  if (name.length > 50) return result({ error: "企业名称最多 50 个字" }, { status: 400 });
  const code = await checkCode(body.code);
  if ("error" in code) return result({ error: code.error }, { status: 400 });
  if (!code.code) return result({ error: "请填写企业编码" }, { status: 400 });
  await ensureSystemOrg();
  if (await prisma.organization.findFirst({ where: { parentId: SYSTEM_ORG_ID, name } })) {
    return result({ error: "已有同名企业" }, { status: 400 });
  }
  const last = await prisma.organization.findFirst({ where: { parentId: SYSTEM_ORG_ID }, orderBy: { sortOrder: "desc" } });
  const org = await prisma.organization.create({
    data: { name, type: "enterprise", parentId: SYSTEM_ORG_ID, code: code.code, sortOrder: (last?.sortOrder ?? -1) + 1 },
    select: { id: true, name: true, code: true },
  });
  await logOrg(session.id, org.id, "created", org);
  return result({ enterprise: org });
}

/** 改企业名称 / 编码：{ name?, code? } */
export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const org = await prisma.organization.findFirst({ where: { id: params.id, type: "enterprise" }, select: { id: true, name: true, code: true } });
  if (!org) return result({ error: "企业不存在" }, { status: 404 });
  const data: { name?: string; code?: string | null } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return result({ error: "企业名称不能为空" }, { status: 400 });
    if (name.length > 50) return result({ error: "企业名称最多 50 个字" }, { status: 400 });
    if (name !== org.name && (await prisma.organization.findFirst({ where: { parentId: SYSTEM_ORG_ID, name, NOT: { id: org.id } } }))) {
      return result({ error: "已有同名企业" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.code !== undefined) {
    const code = await checkCode(body.code, org.id);
    if ("error" in code) return result({ error: code.error }, { status: 400 });
    if (!code.code) return result({ error: "企业编码不能为空" }, { status: 400 });
    data.code = code.code;
  }
  if (!Object.keys(data).length) return result({ error: "无更新字段" }, { status: 400 });
  const updated = await prisma.organization.update({ where: { id: org.id }, data, select: { id: true, name: true, code: true } });
  await logOrg(session.id, org.id, "updated", updated, org);
  return result({ enterprise: updated });
}

/**
 * 指定 / 更换企业超管：
 * - { userId }：本企业（含下级部门）里已启用的账号；
 * - { email, name }：新建账号放在企业下，返回邀请链接（首次登录时本人设置密码）。
 * 新超管角色低于管理者时升为管理者；原超管保留原账号和角色，只是不再是超管。
 */
export async function PUT(session: SessionUser, params: { id: string }, body: Record<string, unknown>, origin = "") {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const org = await prisma.organization.findFirst({ where: { id: params.id, type: "enterprise" }, select: { id: true, name: true, adminUserId: true } });
  if (!org) return result({ error: "企业不存在" }, { status: 404 });
  const orgs = await listOrgs();
  let userId = String(body.userId || "");
  let invite: { link: string; emailed: boolean } | undefined;

  if (!userId) {
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 40);
    if (!email || !name) return result({ error: "请选择本企业的账号，或填写新账号的姓名和邮箱" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return result({ error: "邮箱格式不对" }, { status: 400 });
    const clash = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
    if (clash.length) return result({ error: "这个邮箱已有账号，请在列表里选择它" }, { status: 400 });
    const created = await prisma.user.create({
      data: { name, email, passwordHash: null, globalRole: MANAGER_ROLE, orgId: org.id, isActive: true, mustChangePassword: true },
      select: { id: true, name: true, email: true },
    });
    userId = created.id;
    await prisma.activityLog.create({ data: { entityType: "user", entityId: userId, action: "created", actorId: session.id, toValue: JSON.stringify({ email, globalRole: MANAGER_ROLE, orgId: org.id }) } });
    invite = await issueInvite(created, session.id, origin);
  } else {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, orgId: true, isActive: true, globalRole: true } });
    if (!user || level2OrgId(orgs, user.orgId) !== org.id) return result({ error: "只能指定本企业里的账号" }, { status: 400 });
    if (!user.isActive) return result({ error: "这个账号已停用，请先启用" }, { status: 400 });
    if (user.globalRole === ADMIN_ROLE) return result({ error: "系统超管不能兼任企业超管" }, { status: 400 });
    const other = await prisma.organization.findFirst({ where: { adminUserId: user.id, NOT: { id: org.id } }, select: { name: true } });
    if (other) return result({ error: `这个账号已是「${other.name}」的企业超管` }, { status: 400 });
    if (org.adminUserId === user.id) return result({ ok: true, unchanged: true });
    // 级别低于管理者的（成员、访客、自定义角色）升为管理者，会话作废后重新登录生效
    if (user.globalRole !== MANAGER_ROLE) {
      await prisma.user.update({ where: { id: user.id }, data: { globalRole: MANAGER_ROLE } });
      await revokeUserSessions(user.id);
    }
  }

  await prisma.organization.update({ where: { id: org.id }, data: { adminUserId: userId } });
  await logOrg(session.id, org.id, "admin_changed", { adminUserId: userId }, { adminUserId: org.adminUserId });
  return result({ ok: true, adminUserId: userId, ...(invite ? { inviteLink: invite.link, emailed: invite.emailed } : {}) });
}

/** 企业里可选为超管的账号（含下级部门，已启用，非系统超管） */
export async function candidates(session: SessionUser, params: { id: string }) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const orgs = await listOrgs();
  if (!orgs.some((o) => o.id === params.id && o.type === "enterprise")) return result({ error: "企业不存在" }, { status: 404 });
  const users = await prisma.user.findMany({
    where: { orgId: { in: subtreeIds(orgs, params.id) }, isActive: true, NOT: { globalRole: ADMIN_ROLE } },
    select: { id: true, name: true, email: true, globalRole: true },
    orderBy: { name: "asc" },
  });
  return result({ users });
}
