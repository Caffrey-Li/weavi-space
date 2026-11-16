import type { SessionUser } from "../auth";
import { revokeUserSessions } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { SYSTEM_ORG_ID, ensureSystemOrg } from "../shared/org";
import { result } from "./result";

/**
 * Weavi Space 系统后台 · 系统超管账号（只有系统超管）：
 * 系统超管 = globalRole admin，属于系统组织 Weavi Space，不属于任何企业。
 * 设为系统超管会把账号移到系统组织；取消时降为成员（member），不能取消自己，至少保留一个启用的系统超管。
 */

const deny = () => result({ error: "只有 Weavi Space 系统超管可以管理系统超管账号" }, { status: 403 });

export async function GET(session: SessionUser) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const admins = await prisma.user.findMany({
    where: { globalRole: ADMIN_ROLE },
    select: { id: true, name: true, email: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return result({ admins: admins.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), self: a.id === session.id })) });
}

/** 设为系统超管：{ userId }（已启用、不是企业超管的账号） */
export async function POST(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const userId = String(body.userId || "");
  if (!userId) return result({ error: "请选择账号" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, globalRole: true, orgId: true } });
  if (!user) return result({ error: "账号不存在" }, { status: 404 });
  if (!user.isActive) return result({ error: "这个账号已停用，请先启用" }, { status: 400 });
  if (user.globalRole === ADMIN_ROLE) return result({ ok: true, unchanged: true });
  const ent = await prisma.organization.findFirst({ where: { adminUserId: user.id }, select: { name: true } });
  if (ent) return result({ error: `这个账号是「${ent.name}」的企业超管，请先更换企业超管` }, { status: 400 });
  await ensureSystemOrg();
  await prisma.user.update({ where: { id: user.id }, data: { globalRole: ADMIN_ROLE, orgId: SYSTEM_ORG_ID } });
  await revokeUserSessions(user.id);
  await prisma.activityLog.create({
    data: { entityType: "user", entityId: user.id, action: "system_admin_granted", actorId: session.id, fromValue: JSON.stringify({ globalRole: user.globalRole, orgId: user.orgId }) },
  });
  return result({ ok: true });
}

/** 取消系统超管：?id=，降为成员 */
export async function DELETE(session: SessionUser, requestUrl: string) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const id = new URL(requestUrl).searchParams.get("id") || "";
  if (!id) return result({ error: "缺少账号 id" }, { status: 400 });
  if (id === session.id) return result({ error: "不能取消自己的系统超管" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, globalRole: true } });
  if (!user || user.globalRole !== ADMIN_ROLE) return result({ error: "这个账号不是系统超管" }, { status: 404 });
  const remaining = await prisma.user.count({ where: { globalRole: ADMIN_ROLE, isActive: true, NOT: { id } } });
  if (remaining < 1) return result({ error: "至少要保留一个启用的系统超管" }, { status: 400 });
  await prisma.user.update({ where: { id }, data: { globalRole: "member" } });
  await revokeUserSessions(id);
  await prisma.activityLog.create({ data: { entityType: "user", entityId: id, action: "system_admin_revoked", actorId: session.id, toValue: JSON.stringify({ globalRole: "member" }) } });
  return result({ ok: true });
}

/** 可设为系统超管的账号：已启用、不是系统超管、不是企业超管 */
export async function candidates(session: SessionUser) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const entAdmins = (await prisma.organization.findMany({ where: { adminUserId: { not: null } }, select: { adminUserId: true } })).map((o) => o.adminUserId!);
  const users = await prisma.user.findMany({
    where: { isActive: true, NOT: [{ globalRole: ADMIN_ROLE }, { id: { in: entAdmins } }] },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return result({ users });
}
