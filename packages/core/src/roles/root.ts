import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "../shared/constants";
import { listRoles, rolesForEnterprise } from "../shared/roles";
import { ADMIN_ROLE, DATA_SCOPES, defaultRoleAllow } from "../shared/roles-shared";
import { enterpriseAdminOf } from "../shared/enterprise-admin";
import { enterpriseOfUserId, roleCeiling, saveRoleCeiling } from "../shared/role-ceiling";
import { randomKey } from "../shared/admin-gate";
import { result } from "./result";

const FEATURE_KEYS = new Set<string>(FEATURES.map((f) => f.key));
/** 「全部数据」只属于系统管理员，别的角色不能选 */
const SCOPE_KEYS = new Set<string>(DATA_SCOPES.filter((s) => s.key !== "all").map((s) => s.key));

/**
 * T37 谁能改哪个角色：系统超管 = 全部（系统管理员角色本身除外的权限）；企业超管 = 本企业的企业角色；其他人只读。
 * 返回 null 表示不能改。
 */
export async function roleManager(session: SessionUser): Promise<{ admin: boolean; enterpriseId: string | null }> {
  if (session.globalRole === ADMIN_ROLE) return { admin: true, enterpriseId: null };
  return { admin: false, enterpriseId: await enterpriseAdminOf(session.id) };
}
function canManageRole(m: { admin: boolean; enterpriseId: string | null }, role: { enterpriseId?: string | null }) {
  return m.admin || (Boolean(m.enterpriseId) && role.enterpriseId === m.enterpriseId);
}
/** 看得到的角色：系统超管全部；其他人 = 系统角色 + 本企业角色 */
export async function visibleRoles(session: SessionUser) {
  return rolesForEnterprise(session.globalRole === ADMIN_ROLE ? null : await enterpriseOfUserId(session.id));
}

/** 角色列表：名称、数据范围、功能权限、人数 */
export async function GET(session: SessionUser) {
  const [roles, perms, counts] = await Promise.all([
    visibleRoles(session),
    prisma.rolePermission.findMany({ where: { scope: "role" }, select: { role: true, feature: true, allowed: true } }),
    prisma.user.groupBy({ by: ["globalRole"], _count: { _all: true } }),
  ]);
  return result({
    roles: roles.map((r) => ({
      ...r,
      userCount: counts.find((c) => c.globalRole === r.key)?._count._all || 0,
      permissions: Object.fromEntries(
        FEATURES.map((f) => {
          const row = perms.find((p) => p.role === r.key && p.feature === f.key);
          return [f.key, r.key === "admin" ? true : row ? row.allowed : defaultRoleAllow(r.key, f.key)];
        }),
      ),
    })),
  });
}

function cleanText(v: unknown, max: number) {
  return String(v ?? "").trim().slice(0, max);
}

/** 企业角色要开的功能超出企业上限时返回超出的功能点 */
async function overCeiling(enterpriseId: string | undefined | null, raw: unknown) {
  if (!enterpriseId || !raw || typeof raw !== "object") return [];
  const ceiling = await roleCeiling(enterpriseId);
  return Object.entries(raw as Record<string, unknown>).filter(([f, on]) => FEATURE_KEYS.has(f) && on && !ceiling.includes(f)).map(([f]) => FEATURES.find((x) => x.key === f)?.label || f);
}

async function writePermissions(role: string, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  for (const [feature, allowed] of Object.entries(raw as Record<string, unknown>)) {
    if (!FEATURE_KEYS.has(feature)) continue;
    await prisma.rolePermission.upsert({
      where: { scope_role_feature: { scope: "role", role, feature } },
      create: { scope: "role", role, feature, allowed: Boolean(allowed) },
      update: { allowed: Boolean(allowed) },
    });
  }
}

/** 新建角色：可从已有角色复制功能权限与数据范围 */
export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const m = await roleManager(session);
  // 系统超管可指定企业（不指定 = 系统角色）；企业超管只能建本企业的角色
  const enterpriseId = m.admin ? cleanText(body.enterpriseId, 60) : m.enterpriseId;
  if (enterpriseId === null || enterpriseId === undefined) return result({ error: "只有系统超管和企业超管可以新建角色" }, { status: 403 });
  if (enterpriseId && !(await prisma.organization.findFirst({ where: { id: enterpriseId, type: "enterprise" }, select: { id: true } }))) return result({ error: "企业不存在" }, { status: 400 });
  const name = cleanText(body.name, 30);
  if (!name) return result({ error: "请填写角色名称" }, { status: 400 });
  const roles = await listRoles();
  const usable = roles.filter((r) => !r.enterpriseId || r.enterpriseId === enterpriseId);
  if (usable.some((r) => r.name === name)) return result({ error: "已有同名角色" }, { status: 400 });
  // 只能从本企业能看到的角色复制；企业角色不能从「系统管理员」复制
  const from = usable.find((r) => r.key === String(body.copyFrom || "member") && !(enterpriseId && r.key === ADMIN_ROLE)) || roles.find((r) => r.key === "member");
  const dataScope = SCOPE_KEYS.has(String(body.dataScope)) ? String(body.dataScope) : from && SCOPE_KEYS.has(from.dataScope) ? from.dataScope : "involved";
  // 企业角色的 key 用 ent_ 前缀：权限判断时只有这类角色才去查所属企业和上限
  const prefix = enterpriseId ? "ent" : "role";
  let key = randomKey(prefix);
  while (roles.some((r) => r.key === key)) key = randomKey(prefix);
  const role = await prisma.role.create({
    data: { key, name, description: cleanText(body.description, 100) || null, dataScope, isSystem: false, sortOrder: roles.length, enterpriseId: enterpriseId || "" },
  });
  // 功能权限：先按来源角色复制，再套用请求里给的
  const base: Record<string, boolean> = {};
  if (from) {
    const rows = await prisma.rolePermission.findMany({ where: { scope: "role", role: from.key } });
    for (const f of FEATURES) {
      const row = rows.find((r) => r.feature === f.key);
      base[f.key] = from.key === "admin" ? true : row ? row.allowed : defaultRoleAllow(from.key, f.key);
    }
  }
  // 企业角色：复制来的权限超出企业上限的部分自动关掉；请求里明确要开超出的则拒绝
  const wanted = (body.permissions || {}) as Record<string, unknown>;
  const over = await overCeiling(enterpriseId, wanted);
  if (over.length) {
    await prisma.role.delete({ where: { id: role.id } });
    return result({ error: `超出本企业的权限上限：${over.join("、")}` }, { status: 400 });
  }
  const ceiling = enterpriseId ? await roleCeiling(enterpriseId) : null;
  const merged = { ...base, ...wanted } as Record<string, unknown>;
  if (ceiling) for (const k of Object.keys(merged)) if (!ceiling.includes(k)) merged[k] = false;
  await writePermissions(key, merged);
  await prisma.activityLog.create({ data: { entityType: "role", entityId: role.id, action: "created", actorId: session.id, toValue: name } });
  return result({ role });
}

/** 修改角色：名称、说明、数据范围、功能权限（系统管理员不可改权限和数据范围） */
export async function PATCH(session: SessionUser, body: Record<string, unknown>) {
  const role = await prisma.role.findUnique({ where: { id: String(body.id || "") } });
  const m = await roleManager(session);
  // 看不到的企业角色按不存在
  if (!role || (!m.admin && role.enterpriseId && role.enterpriseId !== (await enterpriseOfUserId(session.id)))) return result({ error: "角色不存在" }, { status: 404 });
  if (!canManageRole(m, role)) return result({ error: "只有系统超管能修改系统角色；企业超管只能修改本企业的角色" }, { status: 403 });
  const over = await overCeiling(role.enterpriseId, body.permissions);
  if (over.length) return result({ error: `超出本企业的权限上限：${over.join("、")}` }, { status: 400 });
  const data: { name?: string; description?: string | null; dataScope?: string } = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 30);
    if (!name) return result({ error: "角色名称不能为空" }, { status: 400 });
    if (name !== role.name && (await prisma.role.findFirst({ where: { name, NOT: { id: role.id }, enterpriseId: { in: role.enterpriseId ? ["", role.enterpriseId] : undefined } } }))) {
      return result({ error: "已有同名角色" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.description !== undefined) data.description = cleanText(body.description, 100) || null;
  if (body.dataScope !== undefined && role.key !== "admin") {
    if (!SCOPE_KEYS.has(String(body.dataScope))) return result({ error: "数据范围不合法" }, { status: 400 });
    data.dataScope = String(body.dataScope);
  }
  if (role.key === "admin" && (body.permissions || body.dataScope)) {
    return result({ error: "系统管理员固定拥有全部权限，不能修改" }, { status: 400 });
  }
  if (Object.keys(data).length) await prisma.role.update({ where: { id: role.id }, data });
  await writePermissions(role.key, body.permissions);
  await prisma.activityLog.create({
    data: { entityType: "role", entityId: role.id, action: "updated", actorId: session.id, toValue: JSON.stringify({ ...data, permissions: body.permissions || undefined }).slice(0, 2000) },
  });
  return result({ ok: true });
}

/** 删除角色：系统内置角色不能删；还有人用的角色先把人调到别的角色 */
export async function DELETE(session: SessionUser, requestUrl: string) {
  const id = new URL(requestUrl).searchParams.get("id") || "";
  const role = await prisma.role.findUnique({ where: { id } });
  const m = await roleManager(session);
  if (!role || (!m.admin && role.enterpriseId && role.enterpriseId !== (await enterpriseOfUserId(session.id)))) return result({ error: "角色不存在" }, { status: 404 });
  if (!canManageRole(m, role)) return result({ error: "只有系统超管能删除系统角色；企业超管只能删除本企业的角色" }, { status: 403 });
  if (role.isSystem) return result({ error: "内置角色不能删除" }, { status: 400 });
  const n = await prisma.user.count({ where: { globalRole: role.key } });
  if (n) return result({ error: `还有 ${n} 人使用「${role.name}」，请先在成员管理里批量调整他们的角色` }, { status: 400 });
  await prisma.rolePermission.deleteMany({ where: { scope: "role", role: role.key } });
  await prisma.role.delete({ where: { id } });
  await prisma.activityLog.create({ data: { entityType: "role", entityId: id, action: "deleted", actorId: session.id, fromValue: role.name } });
  return result({ ok: true });
}

/** T37 企业权限上限：只有系统超管能读写 */
export async function ceilingGET(session: SessionUser, enterpriseId: string) {
  if (session.globalRole !== ADMIN_ROLE) return result({ error: "只有系统超管可以设置企业权限上限" }, { status: 403 });
  return result({ enterpriseId, features: await roleCeiling(enterpriseId) });
}
export async function ceilingPUT(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return result({ error: "只有系统超管可以设置企业权限上限" }, { status: 403 });
  const enterpriseId = cleanText(body.enterpriseId, 60);
  if (!enterpriseId || !(await prisma.organization.findFirst({ where: { id: enterpriseId, type: "enterprise" }, select: { id: true } }))) return result({ error: "企业不存在" }, { status: 400 });
  const features = Array.isArray(body.features) ? body.features.map(String).filter((f) => FEATURE_KEYS.has(f)) : [];
  const saved = await saveRoleCeiling(enterpriseId, features, session.id);
  await prisma.activityLog.create({ data: { entityType: "role_ceiling", entityId: enterpriseId, action: "updated", actorId: session.id, toValue: JSON.stringify(saved) } });
  return result({ enterpriseId, features: saved });
}
