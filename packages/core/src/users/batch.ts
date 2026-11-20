import type { SessionUser } from "../auth";
import { revokeUserSessions } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canAssignRole, userScope } from "../shared/admin-gate";
import { enterpriseAdminIds, enterpriseAuthority } from "../shared/enterprise-admin";
import { roleFitsEnterprise, validPosition, validRole } from "../shared/roles";
import { SYSTEM_ORG_ID, canManageUser, ensureSystemOrg, level2OrgId, listOrgs } from "../shared/org";
import { result } from "./result";

/**
 * 批量调整成员：{ ids: string[], orgId?, globalRole?, position? }，只改传了的字段。
 * position 传空字符串表示清空默认岗位。不改动已有的项目内岗位。
 */
export async function PATCH(session: SessionUser, body: Record<string, unknown>) {
  const ids: string[] = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String))) : [];
  if (!ids.length) return result({ error: "请先选择成员" }, { status: 400 });
  if (ids.length > 500) return result({ error: "一次最多调整 500 人" }, { status: 400 });
  const scope = await userScope(session);
  const targets = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, globalRole: true, orgId: true } });
  for (const t of targets) {
    const authority = await enterpriseAuthority(session, t);
    if (authority === "deny" || (authority !== "allow" && !canManageUser(session.globalRole, scope, t))) {
      return result({ error: "选中的成员里有不归你管理的账号，不能调整" }, { status: 403 });
    }
  }
  // 企业超管的角色和所属组织只能先在 Weavi Space 后台换超管再改
  if ((body.orgId !== undefined || body.globalRole !== undefined) && (await enterpriseAdminIds()).some((id) => ids.includes(id))) {
    return result({ error: "选中的成员里有企业超级管理员，请先在 Weavi Space 后台更换企业超管，再调整角色或组织" }, { status: 400 });
  }

  const data: { orgId?: string; globalRole?: string; position?: string | null } = {};
  const labels: string[] = [];
  if (body.orgId !== undefined) {
    const orgId = String(body.orgId || "") || SYSTEM_ORG_ID;
    if (orgId === SYSTEM_ORG_ID) await ensureSystemOrg();
    else if (!(await prisma.organization.findUnique({ where: { id: orgId } }))) {
      return result({ error: "所属组织不存在" }, { status: 400 });
    }
    if (scope && !scope.has(orgId)) return result({ error: "只能把账号放在自己管理的组织里" }, { status: 403 });
    data.orgId = orgId;
    labels.push("组织");
  }
  if (body.globalRole !== undefined) {
    const role = String(body.globalRole || "");
    if (!(await validRole(role))) return result({ error: "角色不存在" }, { status: 400 });
    if (role !== "admin" && ids.includes(session.id) && session.globalRole === "admin") {
      return result({ error: "选中的成员里有你自己，不能取消自己的系统管理员角色" }, { status: 400 });
    }
    if (!(await canAssignRole(session, role))) {
      return result({ error: "只能授予比自己级别低的角色" }, { status: 403 });
    }
    data.globalRole = role;
    labels.push("角色");
  }
  if (body.position !== undefined) {
    const position = String(body.position || "");
    if (!(await validPosition(position))) return result({ error: "岗位不存在" }, { status: 400 });
    data.position = position || null;
    labels.push("岗位");
  }
  if (!labels.length) return result({ error: "没有要调整的内容" }, { status: 400 });
  // T37 企业角色只能给本企业的人：逐个看调整后的角色和组织是否匹配
  if (data.globalRole !== undefined || data.orgId !== undefined) {
    const orgs = await listOrgs();
    for (const t of targets) {
      if (!(await roleFitsEnterprise(data.globalRole ?? t.globalRole, level2OrgId(orgs, data.orgId ?? t.orgId ?? SYSTEM_ORG_ID) || ""))) {
        return result({ error: data.globalRole !== undefined ? "这个角色属于别的企业，不能给选中的部分成员" : "选中的成员里有人用的是原企业自建的角色，换企业前请先调整角色" }, { status: 400 });
      }
    }
  }

  // 角色真正变了的人，已有会话作废
  const changed = data.globalRole ? (await prisma.user.findMany({ where: { id: { in: ids }, NOT: { globalRole: data.globalRole } }, select: { id: true } })).map((u) => u.id) : [];
  const res = await prisma.user.updateMany({ where: { id: { in: ids } }, data });
  if (changed.length) await revokeUserSessions(changed);
  await prisma.activityLog.create({
    data: {
      entityType: "user",
      entityId: ids.slice(0, 20).join(","),
      action: "batch_updated",
      actorId: session.id,
      toValue: JSON.stringify({ count: res.count, ...data }),
    },
  });
  return result({ ok: true, count: res.count, changed: labels });
}
