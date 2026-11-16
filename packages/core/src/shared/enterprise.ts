import { prisma } from "@pm-collab/db/prisma";
import { getAccess } from "../access";
import { listOrgs, level2OrgId, pickEnterprise, subtreeIds } from "./org";
import { ADMIN_ROLE } from "./roles-shared";
import type { SessionUser } from "../auth";

/**
 * 项目、产品的所属企业（enterpriseId）。规则：
 * - 普通账号建的归自己所在企业；
 * - 系统管理员建的：指定的企业 → 所属产品的企业 → 自己所在企业 → 系统里唯一的企业；都没有就留空（只有系统管理员可见）。
 * 规则本身在 org-shared.ts 的 pickEnterprise。
 */
export class EnterpriseError extends Error {}

export async function enterpriseForNew(actor: SessionUser, opts: { requested?: unknown; productId?: string | null } = {}): Promise<string | null> {
  const [product, orgs, me] = await Promise.all([
    opts.productId ? prisma.product.findUnique({ where: { id: opts.productId }, select: { enterpriseId: true } }) : null,
    listOrgs(),
    prisma.user.findUnique({ where: { id: actor.id }, select: { orgId: true } }),
  ]);
  const r = pickEnterprise({
    isAdmin: actor.globalRole === ADMIN_ROLE,
    own: level2OrgId(orgs, me?.orgId),
    requested: opts.requested ? String(opts.requested) : null,
    product,
    enterprises: orgs.filter((o) => o.type === "enterprise").map((o) => o.id),
  });
  if ("error" in r) throw new EnterpriseError(r.error);
  return r.id;
}

/**
 * 把项目转到另一个企业（系统管理员）。需求、Bug、发版、文档、附件都跟随项目，不用逐条改；
 * 所属产品如果不在新企业，一并解除，项目下需求和 Bug 的产品、功能模块也清掉。全部在一个事务里。
 */
export async function moveProjectEnterprise(projectId: string, enterpriseId: string | null, data: Record<string, unknown>, productId: string | null) {
  const product = productId ? await prisma.product.findUnique({ where: { id: productId }, select: { enterpriseId: true } }) : null;
  const detach = Boolean(product) && product?.enterpriseId !== enterpriseId;
  const clear = { productId: null, productNodeId: null };
  await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { ...data, enterpriseId, ...(detach ? { productId: null } : {}) } }),
    ...(detach ? [prisma.requirement.updateMany({ where: { projectId }, data: clear }), prisma.bug.updateMany({ where: { projectId }, data: clear })] : []),
  ]);
  return { detached: detach };
}

/** 把产品连同它的项目（含产品资料空间）转到另一个企业 */
export async function moveProductEnterprise(productId: string, enterpriseId: string | null, data: Record<string, unknown>) {
  await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data: { ...data, enterpriseId } }),
    prisma.project.updateMany({ where: { productId, OR: [{ deletedAt: null }, { deletedAt: { not: null } }] }, data: { enterpriseId } }),
  ]);
}

/** 能加进某企业项目的人：这个企业的账号和系统管理员。项目还没有企业时不限 */
export async function memberCandidateWhere(enterpriseId: string | null) {
  if (!enterpriseId) return {};
  return { OR: [{ orgId: { in: subtreeIds(await listOrgs(), enterpriseId) } }, { globalRole: ADMIN_ROLE }] };
}

/** 只有唯一结果才算数：多个企业或推不出来时返回 null，留给系统管理员处理，不猜 */
const only = (ids: (string | null | undefined)[]) => {
  const set = new Set(ids.filter((x): x is string => Boolean(x)));
  return set.size === 1 ? Array.from(set)[0] : null;
};

/**
 * 回填（可重复执行，只处理还没有企业的记录）：
 * 产品 ← 负责人的企业，其次关联项目成员的企业；项目 ← 所属产品的企业，其次成员和创建人的企业。
 * 同时把系统管理员以外角色的「全部数据」改成「本企业」。返回本次回填的数量和仍未归属的数量。
 */
export async function backfillEnterprise() {
  await prisma.role.updateMany({ where: { dataScope: "all", key: { not: ADMIN_ROLE } }, data: { dataScope: "enterprise" } });
  const any = { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] };
  const [orgs, products, projects, users] = await Promise.all([
    listOrgs(),
    prisma.product.findMany({ where: { enterpriseId: null, ...any }, select: { id: true, ownerId: true, projects: { select: { members: { select: { userId: true } } } } } }),
    prisma.project.findMany({ where: { enterpriseId: null, ...any }, select: { id: true, createdById: true, productId: true, members: { select: { userId: true } } } }),
    prisma.user.findMany({ select: { id: true, orgId: true } }),
  ]);
  const ent = new Map(users.map((u) => [u.id, level2OrgId(orgs, u.orgId)]));
  let filled = 0;
  let unresolved = 0;
  const productEnt = new Map<string, string>();
  for (const p of products) {
    const id = (p.ownerId && ent.get(p.ownerId)) || only(p.projects.flatMap((x) => x.members.map((m) => ent.get(m.userId))));
    if (!id) {
      unresolved++;
      continue;
    }
    await prisma.product.update({ where: { id: p.id }, data: { enterpriseId: id } });
    productEnt.set(p.id, id);
    filled++;
  }
  const known = await prisma.product.findMany({ where: { enterpriseId: { not: null }, ...any }, select: { id: true, enterpriseId: true } });
  for (const k of known) productEnt.set(k.id, k.enterpriseId as string);
  for (const p of projects) {
    const id = (p.productId && productEnt.get(p.productId)) || only([...p.members.map((m) => ent.get(m.userId)), ent.get(p.createdById ?? "")]);
    if (!id) {
      unresolved++;
      continue;
    }
    await prisma.project.update({ where: { id: p.id }, data: { enterpriseId: id } });
    filled++;
  }
  return { filled, unresolved };
}
