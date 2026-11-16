import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { FEATURES } from "../shared/constants";
import { listRoles } from "../shared/roles";
import { DATA_SCOPES, defaultRoleAllow } from "../shared/roles-shared";
import { randomKey } from "../shared/admin-gate";
import { result } from "./result";

const FEATURE_KEYS = new Set<string>(FEATURES.map((f) => f.key));
/** 「全部数据」只属于系统管理员，别的角色不能选 */
const SCOPE_KEYS = new Set<string>(DATA_SCOPES.filter((s) => s.key !== "all").map((s) => s.key));

/** 角色列表：名称、数据范围、功能权限、人数 */
export async function GET(_session: SessionUser) {
  void _session;
  const [roles, perms, counts] = await Promise.all([
    listRoles(),
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
  const name = cleanText(body.name, 30);
  if (!name) return result({ error: "请填写角色名称" }, { status: 400 });
  const roles = await listRoles();
  if (roles.some((r) => r.name === name)) return result({ error: "已有同名角色" }, { status: 400 });
  const from = roles.find((r) => r.key === String(body.copyFrom || "member")) || roles.find((r) => r.key === "member");
  const dataScope = SCOPE_KEYS.has(String(body.dataScope)) ? String(body.dataScope) : from && SCOPE_KEYS.has(from.dataScope) ? from.dataScope : "involved";
  let key = randomKey("role");
  while (roles.some((r) => r.key === key)) key = randomKey("role");
  const role = await prisma.role.create({
    data: { key, name, description: cleanText(body.description, 100) || null, dataScope, isSystem: false, sortOrder: roles.length },
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
  await writePermissions(key, { ...base, ...(body.permissions || {}) });
  await prisma.activityLog.create({ data: { entityType: "role", entityId: role.id, action: "created", actorId: session.id, toValue: name } });
  return result({ role });
}

/** 修改角色：名称、说明、数据范围、功能权限（系统管理员不可改权限和数据范围） */
export async function PATCH(session: SessionUser, body: Record<string, unknown>) {
  const role = await prisma.role.findUnique({ where: { id: String(body.id || "") } });
  if (!role) return result({ error: "角色不存在" }, { status: 404 });
  const data: { name?: string; description?: string | null; dataScope?: string } = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 30);
    if (!name) return result({ error: "角色名称不能为空" }, { status: 400 });
    if (name !== role.name && (await prisma.role.findFirst({ where: { name, NOT: { id: role.id } } }))) {
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
  if (!role) return result({ error: "角色不存在" }, { status: 404 });
  if (role.isSystem) return result({ error: "内置角色不能删除" }, { status: 400 });
  const n = await prisma.user.count({ where: { globalRole: role.key } });
  if (n) return result({ error: `还有 ${n} 人使用「${role.name}」，请先在成员管理里批量调整他们的角色` }, { status: 400 });
  await prisma.rolePermission.deleteMany({ where: { scope: "role", role: role.key } });
  await prisma.role.delete({ where: { id } });
  await prisma.activityLog.create({ data: { entityType: "role", entityId: id, action: "deleted", actorId: session.id, fromValue: role.name } });
  return result({ ok: true });
}
