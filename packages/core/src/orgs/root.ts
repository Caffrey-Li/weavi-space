import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { SYSTEM_ORG_ID, listOrgs, validParentType, visibleOrgs } from "../shared/org";
import { userScope } from "../shared/admin-gate";

export async function GET(session: SessionUser) {
  const [allOrgs, groups, canManage] = await Promise.all([
    listOrgs(),
    prisma.user.groupBy({ by: ["orgId"], _count: { _all: true } }),
    can(session, "users.manage"),
  ]);
  // 非系统管理员只看本企业
  const scope = await userScope(session);
  const orgs = visibleOrgs(allOrgs, scope);
  // 每个组织直属的账号数（orgId 为空或指向已删组织的算系统组织）；含下级的合计由前端按树累加
  const ids = new Set(orgs.map((o) => o.id));
  const counts: Record<string, number> = {};
  for (const g of groups) {
    const id = g.orgId && ids.has(g.orgId) ? g.orgId : SYSTEM_ORG_ID;
    counts[id] = (counts[id] || 0) + g._count._all;
  }
  return result({ orgs, counts, canManage, editable: scope ? Array.from(scope) : null });
}

export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const type = String(body.type || "");
  const parentId = String(body.parentId || "");
  if (!name) return result({ error: "名称必填" }, { status: 400 });
  if (name.length > 50) return result({ error: "名称最多 50 个字" }, { status: 400 });
  if (type !== "enterprise" && type !== "department") {
    return result({ error: "只能新建企业或部门" }, { status: 400 });
  }
  await listOrgs();
  const parent = parentId ? await prisma.organization.findUnique({ where: { id: parentId } }) : null;
  if (!parent) return result({ error: "上级组织不存在" }, { status: 404 });
  if (!validParentType(type, parent.type)) {
    return result(
      { error: type === "enterprise" ? "企业只能建在 Weavi Space 下" : "部门只能建在企业或部门下" },
      { status: 400 },
    );
  }
  if (!(await can(session, "users.manage"))) {
    return result({ error: "无权限管理组织" }, { status: 403 });
  }
  const scope = await userScope(session);
  // 二级组织（企业）只有系统管理员能建；其余只能在自己管理的组织下建部门
  if (scope && (type !== "department" || !scope.has(parent.id))) {
    return result({ error: "只能在自己管理的组织下新建部门" }, { status: 403 });
  }
  const clash = await prisma.organization.findFirst({ where: { parentId: parent.id, name } });
  if (clash) return result({ error: "同一上级下已有同名组织" }, { status: 400 });
  const last = await prisma.organization.findFirst({ where: { parentId: parent.id }, orderBy: { sortOrder: "desc" } });
  const org = await prisma.organization.create({
    data: { name, type, parentId: parent.id, sortOrder: (last?.sortOrder ?? -1) + 1 },
    select: { id: true, name: true, type: true, parentId: true, sortOrder: true },
  });
  await prisma.activityLog.create({
    data: { entityType: "org", entityId: org.id, action: "created", actorId: session.id, toValue: JSON.stringify(org) },
  });
  return result({ org });
}
