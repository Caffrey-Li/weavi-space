import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { managedEnterprise } from "../ai/credentials";
import { listOrgs, subtreeIds } from "../shared/org";
import { providerConfig } from "../login/providers";
import { normalizePhone, sealPhone } from "../login/phone";

/**
 * T40 飞书组织同步：用企业自己在「登录管理」里配的飞书应用（企业自建应用，需开通通讯录只读权限），
 * 把飞书的部门和成员同步到本企业：
 * - 部门：飞书根部门对应企业本身，其他部门在企业下按层级新建 / 改名（对应关系存 external_orgs）；飞书里删掉的部门只列出来，不删除；
 * - 成员：先按已绑定的飞书身份找，再按企业邮箱 / 邮箱在本企业里找，找到就绑定飞书身份（之后可以直接飞书登录）；
 *   可选：没有账号的新建账号（没有密码，只能飞书登录，角色「成员」）、按飞书部门调整所属部门、飞书离职 / 停用的停用账号；
 * - 只在本企业范围内匹配和修改，不会碰其他企业的账号；系统管理员和企业超管的账号不改组织、不停用。
 * 先预览（dryRun）再执行；每次结果写活动日志。
 */
export type FsDept = { id: string; name: string; parentId: string };
export type FsUser = { id: string; name: string; email: string; mobile: string; deptIds: string[]; resigned: boolean };
export type SyncOptions = { createUsers: boolean; moveUsers: boolean; deactivate: boolean };
type OrgLite = { id: string; name: string; parentId: string | null; type: string };
type UserLite = { id: string; name: string; email: string; orgId: string | null; isActive: boolean; globalRole: string };

export type SyncPlan = {
  deptCreate: { externalId: string; name: string; parentExternal: string }[];
  deptRename: { orgId: string; from: string; to: string }[];
  deptMissing: { orgId: string; name: string }[];
  userBind: { userId: string; name: string; externalId: string }[];
  userCreate: { externalId: string; name: string; email: string; mobile: string; deptExternal: string }[];
  userMove: { userId: string; name: string; deptExternal: string }[];
  userDeactivate: { userId: string; name: string }[];
  skipped: string[];
};

/**
 * 纯函数：根据飞书数据和本系统现状算出要做什么（预览和执行共用）。
 * mapping：飞书部门 id → 本系统组织 id（根部门 "0" 固定对应企业）；identities：飞书 open_id → 账号 id。
 */
export function planSync(input: { enterpriseId: string; depts: FsDept[]; users: FsUser[]; orgs: OrgLite[]; mapping: Map<string, string>; identities: Map<string, string>; members: UserLite[]; protectedIds: Set<string>; options: SyncOptions }): SyncPlan {
  const { depts, users, orgs, mapping, identities, members, options } = input;
  const plan: SyncPlan = { deptCreate: [], deptRename: [], deptMissing: [], userBind: [], userCreate: [], userMove: [], userDeactivate: [], skipped: [] };
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const seenOrgs = new Set<string>();
  for (const d of depts) {
    const orgId = mapping.get(d.id);
    const org = orgId ? orgById.get(orgId) : undefined;
    if (org) {
      seenOrgs.add(org.id);
      if (org.name !== d.name) plan.deptRename.push({ orgId: org.id, from: org.name, to: d.name });
    } else plan.deptCreate.push({ externalId: d.id, name: d.name.slice(0, 60) || "未命名部门", parentExternal: d.parentId || "0" });
  }
  for (const [ext, orgId] of mapping) {
    if (ext === "0" || seenOrgs.has(orgId)) continue;
    const o = orgById.get(orgId);
    if (o) plan.deptMissing.push({ orgId: o.id, name: o.name });
  }
  const byEmail = new Map(members.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m]));
  const byId = new Map(members.map((m) => [m.id, m]));
  const used = new Set<string>();
  for (const u of users) {
    const dept = u.deptIds.find((x) => x === "0" || depts.some((d) => d.id === x)) || "0";
    let m = identities.get(u.id) ? byId.get(identities.get(u.id)!) : undefined;
    if (!m && u.email) {
      const hit = byEmail.get(u.email.toLowerCase());
      if (hit && !used.has(hit.id) && ![...identities.values()].includes(hit.id)) {
        m = hit;
        plan.userBind.push({ userId: hit.id, name: hit.name, externalId: u.id });
      }
    }
    if (!m) {
      if (u.resigned) continue;
      if (!options.createUsers) plan.skipped.push(`${u.name}：本企业没有同邮箱的账号（打开「新建账号」可自动建）`);
      else if (!u.email) plan.skipped.push(`${u.name}：飞书里没有邮箱，不能新建账号`);
      else if (members.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) plan.skipped.push(`${u.name}：邮箱已被本企业其他账号使用`);
      else plan.userCreate.push({ externalId: u.id, name: u.name.slice(0, 40) || u.email, email: u.email.toLowerCase(), mobile: u.mobile, deptExternal: dept });
      continue;
    }
    used.add(m.id);
    if (input.protectedIds.has(m.id)) continue;
    if (u.resigned) {
      if (options.deactivate && m.isActive) plan.userDeactivate.push({ userId: m.id, name: m.name });
      continue;
    }
    if (options.moveUsers) {
      const target = dept === "0" ? input.enterpriseId : mapping.get(dept);
      if (target !== m.orgId) plan.userMove.push({ userId: m.id, name: m.name, deptExternal: dept });
    }
  }
  return plan;
}

// ———————————————————— 飞书接口（应用身份，企业自己的应用） ————————————————————

async function tenantToken(appId: string, appSecret: string) {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }), cache: "no-store" });
  const d = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string };
  if (d.code !== 0 || !d.tenant_access_token) throw new Error(`获取飞书应用令牌失败：${d.msg || res.status}`);
  return d.tenant_access_token;
}

async function fsGet<T>(token: string, path: string, query: Record<string, string>) {
  const res = await fetch(`https://open.feishu.cn/open-apis${path}?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const d = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
  if (d.code === 99991672 || d.code === 99991679) throw new Error("飞书应用缺少通讯录权限：请在开发者后台开通「获取通讯录基本信息」「获取部门信息」「获取用户邮箱 / 手机号」等只读权限，并把通讯录权限范围设为全部成员后发布");
  if (d.code !== 0) throw new Error(`飞书接口返回错误：${d.msg || "未知"}（${d.code ?? res.status}）`);
  return (d.data ?? {}) as T;
}

/** 拉全部部门和成员（部门最多 2000 个、成员最多 5000 人） */
export async function fetchFeishuDirectory(appId: string, appSecret: string): Promise<{ depts: FsDept[]; users: FsUser[] }> {
  const token = await tenantToken(appId, appSecret);
  const depts: FsDept[] = [];
  let pageToken = "";
  for (let i = 0; i < 40; i++) {
    const d = await fsGet<{ items?: { open_department_id: string; name: string; parent_department_id: string }[]; has_more?: boolean; page_token?: string }>(token, "/contact/v3/departments/0/children", { fetch_child: "true", page_size: "50", department_id_type: "open_department_id", ...(pageToken ? { page_token: pageToken } : {}) });
    for (const x of d.items || []) depts.push({ id: x.open_department_id, name: x.name, parentId: x.parent_department_id || "0" });
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  const users = new Map<string, FsUser>();
  for (const dept of ["0", ...depts.map((d) => d.id)]) {
    let pt = "";
    for (let i = 0; i < 20; i++) {
      const d = await fsGet<{ items?: { open_id: string; name: string; email?: string; enterprise_email?: string; mobile?: string; department_ids?: string[]; status?: { is_resigned?: boolean; is_frozen?: boolean } }[]; has_more?: boolean; page_token?: string }>(token, "/contact/v3/users/find_by_department", { department_id: dept, department_id_type: "open_department_id", user_id_type: "open_id", page_size: "50", ...(pt ? { page_token: pt } : {}) });
      for (const u of d.items || []) {
        if (!users.has(u.open_id)) users.set(u.open_id, { id: u.open_id, name: u.name, email: (u.enterprise_email || u.email || "").trim(), mobile: u.mobile || "", deptIds: u.department_ids || [dept], resigned: Boolean(u.status?.is_resigned || u.status?.is_frozen) });
      }
      if (!d.has_more || !d.page_token) break;
      pt = d.page_token;
    }
    if (users.size > 5000) break;
  }
  return { depts, users: Array.from(users.values()) };
}

// ———————————————————— 管理接口 ————————————————————

async function scopeOf(session: SessionUser, raw: unknown) {
  const ent = await managedEnterprise(session, raw ? String(raw) : null);
  return ent.current ? { list: ent.list, current: ent.current } : null;
}

const cleanOptions = (o: unknown): SyncOptions => {
  const v = (o || {}) as Record<string, unknown>;
  return { createUsers: v.createUsers === true, moveUsers: v.moveUsers === true, deactivate: v.deactivate === true };
};

export async function orgSyncInfo(session: SessionUser, scopeRaw: string | null) {
  const s = await scopeOf(session, scopeRaw);
  if (!s) return result({ error: "只有系统超管和企业超管可以同步组织架构" }, { status: 403 });
  const p = await providerConfig(s.current.id, "feishu");
  const last = await prisma.activityLog.findFirst({ where: { entityType: "org_sync", entityId: s.current.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, message: true } });
  return result({ scopes: s.list, scope: s.current.id, configured: Boolean(p?.config.appId && p?.config.appSecret), last: last ? { at: last.createdAt.toISOString(), message: last.message } : null });
}

/** { scope, apply?: boolean, options } ：apply 为 false 时只预览 */
export async function runOrgSync(session: SessionUser, body: Record<string, unknown>) {
  const s = await scopeOf(session, body.scope);
  if (!s || (body.scope && String(body.scope) !== s.current.id)) return result({ error: "没有这个企业的管理权限" }, { status: 403 });
  const enterpriseId = s.current.id;
  const p = await providerConfig(enterpriseId, "feishu");
  if (!p?.config.appId || !p.config.appSecret) return result({ error: "本企业还没有配置飞书应用：请先在「登录管理」里填写本企业飞书应用的 App ID 和 App Secret" }, { status: 400 });
  const options = cleanOptions(body.options);
  let dir;
  try {
    dir = await fetchFeishuDirectory(String(p.config.appId), String(p.config.appSecret));
  } catch (e) {
    return result({ error: (e as Error).message }, { status: 400 });
  }
  const load = async () => {
    const all = await listOrgs();
    const ids = subtreeIds(all, enterpriseId);
    const orgs = all.filter((o) => ids.includes(o.id));
    const maps = await prisma.externalOrg.findMany({ where: { provider: "feishu", scope: enterpriseId } });
    const mapping = new Map<string, string>([["0", enterpriseId], ...maps.filter((m) => ids.includes(m.orgId)).map((m) => [m.externalId, m.orgId] as [string, string])]);
    const members = await prisma.user.findMany({ where: { orgId: { in: ids } }, select: { id: true, name: true, email: true, orgId: true, isActive: true, globalRole: true } });
    const idRows = await prisma.userIdentity.findMany({ where: { provider: "feishu", scope: enterpriseId, userId: { in: members.map((m) => m.id) } } });
    const ent = await prisma.organization.findUnique({ where: { id: enterpriseId }, select: { adminUserId: true } });
    const protectedIds = new Set(members.filter((m) => m.globalRole === "admin" || m.id === ent?.adminUserId || m.id === session.id).map((m) => m.id));
    return { orgs, mapping, members, identities: new Map(idRows.map((r) => [r.externalId, r.userId])), protectedIds };
  };
  const ctx = await load();
  const plan = planSync({ enterpriseId, depts: dir.depts, users: dir.users, options, ...ctx });
  const summary = { depts: dir.depts.length, users: dir.users.length, deptCreate: plan.deptCreate.length, deptRename: plan.deptRename.length, deptMissing: plan.deptMissing.length, userBind: plan.userBind.length, userCreate: plan.userCreate.length, userMove: plan.userMove.length, userDeactivate: plan.userDeactivate.length, skipped: plan.skipped.length };
  if (body.apply !== true) return result({ preview: true, summary, plan: { ...plan, skipped: plan.skipped.slice(0, 50) } });

  // 执行：先部门（按层级，父部门先建），再成员
  const mapping = new Map(ctx.mapping);
  const pending = [...plan.deptCreate];
  for (let round = 0; pending.length && round < 30; round++) {
    for (let i = 0; i < pending.length; ) {
      const d = pending[i];
      const parent = mapping.get(d.parentExternal);
      if (!parent) {
        i++;
        continue;
      }
      const org = await prisma.organization.create({ data: { name: d.name, type: "department", parentId: parent } });
      await prisma.externalOrg.upsert({ where: { provider_scope_externalId: { provider: "feishu", scope: enterpriseId, externalId: d.externalId } }, create: { provider: "feishu", scope: enterpriseId, externalId: d.externalId, orgId: org.id }, update: { orgId: org.id, syncedAt: new Date() } });
      mapping.set(d.externalId, org.id);
      pending.splice(i, 1);
    }
  }
  for (const r of plan.deptRename) await prisma.organization.update({ where: { id: r.orgId }, data: { name: r.to.slice(0, 60) } });
  for (const b of plan.userBind) await prisma.userIdentity.create({ data: { userId: b.userId, provider: "feishu", scope: enterpriseId, externalId: b.externalId } }).catch(() => undefined);
  const orgFor = (ext: string) => (ext === "0" ? enterpriseId : mapping.get(ext) || enterpriseId);
  let created = 0;
  for (const c of plan.userCreate) {
    if (await prisma.user.findFirst({ where: { email: c.email }, select: { id: true } })) continue; // 邮箱被其他企业占用时不建
    const phone = normalizePhone(c.mobile);
    const sealed = phone && !(await prisma.user.findUnique({ where: { phoneHash: sealPhone(phone).phoneHash }, select: { id: true } })) ? sealPhone(phone) : null;
    const u = await prisma.user.create({ data: { name: c.name, email: c.email, passwordHash: null, globalRole: "member", orgId: orgFor(c.deptExternal), ...(sealed || {}) } });
    await prisma.userIdentity.create({ data: { userId: u.id, provider: "feishu", scope: enterpriseId, externalId: c.externalId } }).catch(() => undefined);
    created++;
  }
  for (const m of plan.userMove) await prisma.user.update({ where: { id: m.userId }, data: { orgId: orgFor(m.deptExternal) } });
  if (plan.userDeactivate.length) {
    const { revokeUserSessions } = await import("../auth");
    await prisma.user.updateMany({ where: { id: { in: plan.userDeactivate.map((d) => d.userId) } }, data: { isActive: false } });
    await revokeUserSessions(plan.userDeactivate.map((d) => d.userId));
  }
  const message = `飞书组织同步：新建部门 ${plan.deptCreate.length - pending.length}，改名 ${plan.deptRename.length}，绑定成员 ${plan.userBind.length}，新建账号 ${created}，调整部门 ${plan.userMove.length}，停用 ${plan.userDeactivate.length}${plan.skipped.length ? `，跳过 ${plan.skipped.length}` : ""}`;
  await prisma.activityLog.create({ data: { entityType: "org_sync", entityId: enterpriseId, action: "synced", actorId: session.id, message, toValue: JSON.stringify({ ...summary, userCreate: created, options }) } });
  return result({ ok: true, message, summary: { ...summary, userCreate: created } });
}
