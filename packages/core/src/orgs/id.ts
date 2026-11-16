import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { SYSTEM_ORG_ID, canEditOrg, listOrgs, subtreeIds, validParentType } from "../shared/org";
import { userScope } from "../shared/admin-gate";

const SELECT = { id: true, name: true, type: true, parentId: true, sortOrder: true } as const;

/** 改名或调整上级 */
export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const orgs = await listOrgs();
  const org = orgs.find((o) => o.id === params.id);
  if (!org) return result({ error: "组织不存在" }, { status: 404 });
  if (org.id === SYSTEM_ORG_ID) return result({ error: "系统组织不能修改" }, { status: 400 });

  const data: { name?: string; parentId?: string } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return result({ error: "名称不能为空" }, { status: 400 });
    if (name.length > 50) return result({ error: "名称最多 50 个字" }, { status: 400 });
    data.name = name;
  }
  if (typeof body.parentId === "string" && body.parentId !== org.parentId) {
    const parent = orgs.find((o) => o.id === body.parentId);
    if (!parent) return result({ error: "上级组织不存在" }, { status: 404 });
    if (!validParentType(org.type, parent.type)) {
      return result({ error: "部门只能放在企业或部门下" }, { status: 400 });
    }
    if (subtreeIds(orgs, org.id).includes(parent.id)) {
      return result({ error: "不能移到自己或自己的下级部门下" }, { status: 400 });
    }
    data.parentId = parent.id;
  }
  if (Object.keys(data).length === 0) return result({ error: "无更新字段" }, { status: 400 });
  if (!(await can(session, "users.manage"))) {
    return result({ error: "无权限管理组织" }, { status: 403 });
  }
  const scope = await userScope(session);
  if (!canEditOrg(scope, org) || (scope && data.parentId && !scope.has(data.parentId))) {
    return result({ error: "只能修改自己管理的组织里的部门" }, { status: 403 });
  }
  const parentId = data.parentId ?? org.parentId;
  const name = data.name ?? org.name;
  const clash = await prisma.organization.findFirst({ where: { parentId, name, NOT: { id: org.id } } });
  if (clash) return result({ error: "同一上级下已有同名组织" }, { status: 400 });

  const updated = await prisma.organization.update({ where: { id: org.id }, data, select: SELECT });
  await prisma.activityLog.create({
    data: {
      entityType: "org",
      entityId: org.id,
      action: "updated",
      actorId: session.id,
      fromValue: JSON.stringify(org),
      toValue: JSON.stringify(updated),
    },
  });
  return result({ org: updated });
}

/** 删除：有下级部门时不允许；组织里的账号移到上级组织 */
export async function DELETE(session: SessionUser, params: { id: string }) {
  const orgs = await listOrgs();
  const org = orgs.find((o) => o.id === params.id);
  if (!org) return result({ error: "组织不存在" }, { status: 404 });
  if (org.id === SYSTEM_ORG_ID) return result({ error: "系统组织不能删除" }, { status: 400 });
  if (!(await can(session, "users.manage"))) {
    return result({ error: "无权限管理组织" }, { status: 403 });
  }
  if (!canEditOrg(await userScope(session), org)) {
    return result({ error: "只能删除自己管理的组织里的部门" }, { status: 403 });
  }
  if (orgs.some((o) => o.parentId === org.id)) {
    return result({ error: "请先删除或移走下级部门" }, { status: 400 });
  }
  const parentId = org.parentId ?? SYSTEM_ORG_ID;
  const [moved] = await prisma.$transaction([
    prisma.user.updateMany({ where: { orgId: org.id }, data: { orgId: parentId } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  await prisma.activityLog.create({
    data: { entityType: "org", entityId: org.id, action: "deleted", actorId: session.id, fromValue: JSON.stringify(org) },
  });
  return result({ ok: true, movedUsers: moved.count, movedTo: parentId });
}
