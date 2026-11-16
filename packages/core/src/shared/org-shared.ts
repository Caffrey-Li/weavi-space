/** 组织架构的常量与纯函数（前后端共用，不依赖 Prisma） */
import { outranks } from "./roles-shared";

/** 系统组织：固定 id，唯一、最高级；不能改名、移动或删除。没有所属组织的账号都算在它下面。 */
export const SYSTEM_ORG_ID = "org_nova_collab";
export const SYSTEM_ORG_NAME = "Weavi Space";

export const ORG_TYPES = ["system", "enterprise", "department"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABELS: Record<string, string> = {
  system: "系统组织",
  enterprise: "企业",
  department: "部门",
};

export type OrgRow = { id: string; name: string; type: string; parentId: string | null; sortOrder: number };

/** 某组织自身 + 全部下级的 id */
export function subtreeIds(orgs: OrgRow[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const o of orgs) if (o.parentId === out[i]) out.push(o.id);
  }
  return out;
}

/** 某组织所属的二级组织（直属系统组织的企业）；本身就在系统组织、或组织已不存在时返回 null */
export function level2OrgId(orgs: OrgRow[], orgId: string | null | undefined): string | null {
  let cur = orgs.find((o) => o.id === orgId);
  for (let i = 0; cur && i < 50; i++) {
    if (cur.parentId === SYSTEM_ORG_ID) return cur.id;
    const parentId: string | null = cur.parentId;
    cur = orgs.find((o) => o.id === parentId);
  }
  return null;
}

/** 非系统管理员能管的组织：自己所属二级组织及其全部下级。挂在系统组织下的人没有二级组织，什么都管不了 */
export function managedOrgIds(orgs: OrgRow[], orgId: string | null | undefined): string[] {
  const root = level2OrgId(orgs, orgId);
  return root ? subtreeIds(orgs, root) : [];
}

/** 组织树里能看到的部分：管理范围 + 通往它的上级。scope 为 null 表示不限（系统管理员） */
export function visibleOrgs(orgs: OrgRow[], scope: Set<string> | null): OrgRow[] {
  if (!scope) return orgs;
  const keep = new Set<string>([SYSTEM_ORG_ID, ...Array.from(scope)]);
  return orgs.filter((o) => keep.has(o.id));
}

/** 能否管理这个账号：系统管理员不限；其余要级别比自己低，且在自己的管理范围内（所以不能改自己、同级和别的二级组织的人） */
export function canManageUser(actorRole: string, scope: Set<string> | null, target: { globalRole: string; orgId: string | null }) {
  if (!outranks(actorRole, target.globalRole)) return false;
  return !scope || scope.has(target.orgId || SYSTEM_ORG_ID);
}

/** 能否改这个组织：系统管理员不限；其余只能改管理范围内的部门，二级组织本身和系统组织不能动 */
export function canEditOrg(scope: Set<string> | null, org: { id: string; type: string }) {
  return !scope || (scope.has(org.id) && org.type === "department");
}

/**
 * 新建项目 / 产品归哪个企业：
 * 普通账号只看自己的企业，传来的值一律忽略；系统管理员依次看 指定的 → 所属产品的 → 自己的 → 唯一的企业。
 * 返回企业 id（可为 null，只有系统管理员可见）或错误文案。
 */
export function pickEnterprise(i: {
  isAdmin: boolean;
  own: string | null;
  requested?: string | null;
  product?: { enterpriseId: string | null } | null;
  enterprises: string[];
}): { id: string | null } | { error: string } {
  if (!i.isAdmin) {
    if (!i.own) return { error: "你还不属于任何企业，请联系系统管理员" };
    if (i.product && i.product.enterpriseId !== i.own) return { error: "所选产品不属于你的企业" };
    return { id: i.own };
  }
  if (i.requested) {
    if (!i.enterprises.includes(i.requested)) return { error: "所选企业不存在" };
    if (i.product?.enterpriseId && i.product.enterpriseId !== i.requested) return { error: "所选产品不属于所选企业" };
    return { id: i.requested };
  }
  return { id: i.product?.enterpriseId ?? i.own ?? (i.enterprises.length === 1 ? i.enterprises[0] : null) };
}

/** 合法的上级：企业只能挂在系统组织下；部门挂在企业或部门下 */
export function validParentType(type: string, parentType: string) {
  if (type === "enterprise") return parentType === "system";
  if (type === "department") return parentType === "enterprise" || parentType === "department";
  return false;
}

/** 按树的先序展开，带层级（用于下拉框缩进和树渲染） */
export function flattenOrgs(orgs: OrgRow[]): (OrgRow & { depth: number })[] {
  const out: (OrgRow & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const o of orgs) {
      if (o.parentId !== parentId) continue;
      out.push({ ...o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
