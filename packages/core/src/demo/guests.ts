import { createHash, randomBytes } from "crypto";
import { prisma } from "@pm-collab/db/prisma";
import { startSession, type SessionUser } from "../auth";
import { hitIp } from "../shared/rate-limit";
import { ADMIN_ROLE, DEFAULT_POSITIONS } from "../shared/roles-shared";
import { DEMO_EMAIL_DOMAIN } from "./data";
import { demoOrgId, joinDemoProjects } from "./service";

/**
 * 体验账号：系统超管在「演示体验」里创建，分只读（users.isDemo，角色 guest，所有写请求被拒）和可编辑
 * （角色 member，只能在演示组织里新建和修改，重置演示数据时清掉）。登录只靠体验链接（login_tokens.purpose = demo，
 * 只存哈希，链接只在创建或换新时显示一次），到期（users.demoExpiresAt）后链接和会话都失效。
 * 登录页一键体验（system_settings.demoOneClick = on）进入的是只读的共享访客账号（demoKind = oneclick）。
 */

export const ONE_CLICK_KEY = "demoOneClick";
const PURPOSE = "demo";
const DAY = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = [1, 7, 30];
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const deny = () => ({ error: "只有系统超管可以操作", status: 403 });

export type GuestRow = { id: string; name: string; kind: "readonly" | "editable"; position: string | null; expiresAt: string | null; lastUsedAt: string | null; isActive: boolean; expired: boolean };

async function validPosition(key: string) {
  if (!key) return false;
  if (DEFAULT_POSITIONS.some((p) => p.key === key)) return true;
  return Boolean(await prisma.position.findFirst({ where: { key }, select: { id: true } }));
}

async function issueLink(userId: string, expiresAt: Date, by: string) {
  await prisma.loginToken.deleteMany({ where: { userId, purpose: PURPOSE } });
  const token = randomBytes(24).toString("base64url");
  await prisma.loginToken.create({ data: { userId, purpose: PURPOSE, tokenHash: hash(token), expiresAt, createdById: by } });
  return `/login?invite=${token}`;
}

export async function listGuests(session: SessionUser): Promise<{ guests: GuestRow[] } | { error: string; status: number }> {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const orgId = await demoOrgId();
  if (!orgId) return { guests: [] };
  const users = await prisma.user.findMany({
    where: { orgId, demoKind: { in: ["readonly", "editable"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, demoKind: true, position: true, demoExpiresAt: true, isActive: true, sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } } },
  });
  const now = Date.now();
  return {
    guests: users.map((u) => ({
      id: u.id,
      name: u.name,
      kind: u.demoKind === "editable" ? "editable" : "readonly",
      position: u.demoKind === "editable" ? u.position : null,
      expiresAt: u.demoExpiresAt?.toISOString() ?? null,
      lastUsedAt: u.sessions[0]?.lastSeenAt.toISOString() ?? null,
      isActive: u.isActive,
      expired: Boolean(u.demoExpiresAt && u.demoExpiresAt.getTime() <= now),
    })),
  };
}

/** 新建：{ name, kind: readonly|editable, position?, days: 1|7|30 }，返回只显示一次的体验链接 */
export async function createGuest(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const orgId = await demoOrgId();
  if (!orgId) return { error: "先生成演示组织", status: 400 };
  const name = String(body.name ?? "").trim();
  if (!name) return { error: "请填写名称", status: 400 };
  if (name.length > 30) return { error: "名称最多 30 个字", status: 400 };
  const kind = body.kind === "editable" ? "editable" : body.kind === "readonly" ? "readonly" : null;
  if (!kind) return { error: "请选择方式", status: 400 };
  const position = kind === "editable" ? String(body.position ?? "") : null;
  if (kind === "editable" && !(await validPosition(position!))) return { error: "请选择岗位", status: 400 };
  const days = Number(body.days);
  if (!ALLOWED_DAYS.includes(days)) return { error: "有效期只能选 1 天、7 天或 30 天", status: 400 };
  const expiresAt = new Date(Date.now() + days * DAY);
  const user = await prisma.user.create({
    data: {
      email: `guest-${randomBytes(6).toString("hex")}@${DEMO_EMAIL_DOMAIN}`,
      name,
      passwordHash: null,
      globalRole: kind === "editable" ? "member" : "guest",
      // 只读体验账号按项目经理版式看工作台（项目进度、发版计划），可编辑的按所选岗位
      position: position ?? "pm",
      isDemo: kind === "readonly",
      demoKind: kind,
      demoExpiresAt: expiresAt,
      orgId,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  await joinDemoProjects(orgId, [user.id]);
  const link = await issueLink(user.id, expiresAt, session.id);
  await prisma.activityLog.create({ data: { entityType: "user", entityId: user.id, action: "demo_guest_created", actorId: session.id, message: `创建体验账号「${name}」（${kind === "editable" ? "可编辑" : "只读"}，${days} 天）` } });
  return { ok: true as const, id: user.id, link, kind, position, expiresAt: expiresAt.toISOString() };
}

async function guestOf(id: string) {
  const orgId = await demoOrgId();
  if (!orgId) return null;
  return prisma.user.findFirst({ where: { id, orgId, demoKind: { in: ["readonly", "editable"] } }, select: { id: true, name: true, demoExpiresAt: true, isActive: true } });
}

/** { id, action: relink | extend | disable | enable } */
export async function updateGuest(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const g = await guestOf(String(body.id ?? ""));
  if (!g) return { error: "体验账号不存在", status: 404 };
  const action = String(body.action ?? "");
  if (action === "relink") {
    const exp = g.demoExpiresAt && g.demoExpiresAt.getTime() > Date.now() ? g.demoExpiresAt : new Date(Date.now() + 7 * DAY);
    if (exp !== g.demoExpiresAt) await prisma.user.update({ where: { id: g.id }, data: { demoExpiresAt: exp } });
    return { ok: true as const, link: await issueLink(g.id, exp, session.id), expiresAt: exp.toISOString() };
  }
  if (action === "extend") {
    const base = Math.max(Date.now(), g.demoExpiresAt?.getTime() ?? 0);
    const exp = new Date(base + 7 * DAY);
    await prisma.user.update({ where: { id: g.id }, data: { demoExpiresAt: exp } });
    await prisma.loginToken.updateMany({ where: { userId: g.id, purpose: PURPOSE }, data: { expiresAt: exp } });
    return { ok: true as const, expiresAt: exp.toISOString() };
  }
  if (action === "disable" || action === "enable") {
    await prisma.user.update({ where: { id: g.id }, data: { isActive: action === "enable" } });
    if (action === "disable") await prisma.session.updateMany({ where: { userId: g.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true as const };
  }
  return { error: "不支持的操作", status: 400 };
}

/** 删除体验账号：它在演示组织里建的内容转给演示组织负责人（周敏），再删账号 */
export async function deleteGuest(session: SessionUser, id: string) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const g = await guestOf(id);
  if (!g) return { error: "体验账号不存在", status: 404 };
  const heir = await prisma.user.findFirst({ where: { email: `zhou@${DEMO_EMAIL_DOMAIN}` }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    if (heir) {
      await tx.requirement.updateMany({ where: { creatorId: g.id }, data: { creatorId: heir.id } });
      await tx.bug.updateMany({ where: { creatorId: g.id }, data: { creatorId: heir.id } });
      await tx.docPage.updateMany({ where: { creatorId: g.id }, data: { creatorId: heir.id } });
      await tx.requirementComment.updateMany({ where: { authorId: g.id }, data: { authorId: heir.id } });
      await tx.bugComment.updateMany({ where: { authorId: g.id }, data: { authorId: heir.id } });
      await tx.attachment.updateMany({ where: { uploaderId: g.id }, data: { uploaderId: heir.id } });
    }
    await tx.notification.deleteMany({ where: { userId: g.id } });
    await tx.user.delete({ where: { id: g.id } });
  });
  return { ok: true as const };
}

/** 体验链接落地页显示的信息；无效、过期、停用都返回 null */
export async function demoLinkInfo(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.loginToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { purpose: true, expiresAt: true, user: { select: { id: true, name: true, isActive: true, demoKind: true, demoExpiresAt: true, position: true, org: { select: { name: true } } } } },
  });
  const now = Date.now();
  if (!row || row.purpose !== PURPOSE || row.expiresAt.getTime() <= now) return null;
  const u = row.user;
  if (!u.isActive || !u.demoKind || !["readonly", "editable"].includes(u.demoKind) || (u.demoExpiresAt && u.demoExpiresAt.getTime() <= now)) return null;
  return { userId: u.id, name: u.name, kind: u.demoKind as "readonly" | "editable", position: u.position, orgName: u.org?.name ?? "", expiresAt: (u.demoExpiresAt ?? row.expiresAt).toISOString() };
}

/** 用体验链接登录（POST { token }）：链接在有效期内可以重复使用 */
export async function loginWithDemoLink(token: string, ip: string) {
  const wait = hitIp(ip, "demo-link");
  if (wait) return { error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试`, status: 429 };
  const info = await demoLinkInfo(token);
  if (!info) return { error: "这个体验链接已失效，请联系发给你的人重新获取", status: 410 };
  await startSession(info.userId, false);
  return { ok: true as const };
}

/** 登录页一键体验开关（需要先有演示组织） */
export async function oneClickOn() {
  const row = await prisma.systemSetting.findUnique({ where: { key: ONE_CLICK_KEY } });
  return row?.value === "on" && Boolean(await demoOrgId());
}

export async function setOneClick(session: SessionUser, on: boolean) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  if (on && !(await demoOrgId())) return { error: "先生成演示组织", status: 400 };
  await prisma.systemSetting.upsert({ where: { key: ONE_CLICK_KEY }, create: { key: ONE_CLICK_KEY, value: on ? "on" : "off" }, update: { value: on ? "on" : "off" } });
  return { ok: true as const, on };
}
