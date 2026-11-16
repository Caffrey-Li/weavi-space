import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { cleanEnvs, parseEnvs } from "../shared/product-envs";
import { LifecycleError, runAction } from "../shared/lifecycle";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, productVisible, projectWhere } from "../access";
import { moveProductEnterprise } from "../shared/enterprise";
import { PRODUCT_STATUS } from "../shared/products";

export async function GET(session: SessionUser, params: { id: string }) {
  const p = await prisma.product.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      description: true,
      ownerId: true,
      enterpriseId: true,
      environments: true,
      projects: { where: { status: { not: "space" }, deletedAt: null }, select: { id: true } },
      _count: { select: { nodes: true, requirements: { where: { archivedAt: null } } } },
    },
  });
  if (!p || !(await productVisible(session, p.id))) return result({ error: "产品不存在" }, { status: 404 });
  return result({
    product: {
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      description: p.description || "",
      ownerId: p.ownerId || "",
      enterpriseId: p.enterpriseId || "",
      projectIds: p.projects.map((x) => x.id),
      environments: parseEnvs(p.environments),
      counts: { nodes: p._count.nodes, requirements: p._count.requirements, projects: p.projects.length },
    },
  });
}

export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const existing = await prisma.product.findUnique({ where: { id: params.id } });
  if (!existing) return result({ error: "产品不存在" }, { status: 404 });
  const data: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return result({ error: "请填写产品名称" }, { status: 400 });
    data.name = name;
  }
  if ("code" in body && String(body.code || "").trim().toUpperCase() !== existing.code) {
    return result({ error: "产品编码创建后不能修改" }, { status: 400 });
  }
  if ("description" in body) data.description = body.description ? String(body.description).slice(0, 500) : null;
  if ("ownerId" in body) {
    const ownerId = body.ownerId ? String(body.ownerId) : null;
    if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, isActive: true } }))) {
      return result({ error: "负责人不存在或已停用" }, { status: 400 });
    }
    data.ownerId = ownerId;
  }
  if ("environments" in body) {
    const { envs, error } = cleanEnvs(body.environments);
    if (error) return result({ error }, { status: 400 });
    data.environments = envs.length ? JSON.stringify(envs) : null;
  }
  if ("status" in body) {
    if (!PRODUCT_STATUS.some((s) => s.key === body.status)) return result({ error: "产品状态无效" }, { status: 400 });
    data.status = String(body.status);
  }
  const moving = body.enterpriseId !== undefined && (body.enterpriseId || null) !== existing.enterpriseId;
  let target: string | null = null;
  if (moving) {
    if (session.globalRole !== "admin") return result({ error: "只有系统管理员可以调整所属企业" }, { status: 403 });
    target = body.enterpriseId ? String(body.enterpriseId) : null;
    if (target && (await prisma.organization.findUnique({ where: { id: target }, select: { type: true } }))?.type !== "enterprise") {
      return result({ error: "所选企业不存在" }, { status: 400 });
    }
  }
  if (Array.isArray(body.projectIds)) {
    // 只动自己数据范围内的项目：看不到的项目既不能挂进来，也不会被解除
    const scope = projectWhere(await getAccess(session));
    const visible = await prisma.project.findMany({ where: { ...scope, id: { in: body.projectIds.map(String) } }, select: { id: true } });
    const ids = visible.map((p) => p.id);
    const before = await prisma.project.findMany({ where: { AND: [scope], productId: existing.id, status: { not: "space" } }, select: { id: true } });
    await prisma.$transaction([
      prisma.project.updateMany({ where: { AND: [scope], productId: existing.id, id: { notIn: ids }, status: { not: "space" } }, data: { productId: null } }),
      prisma.project.updateMany({ where: { id: { in: ids } }, data: { productId: existing.id } }),
    ]);
    await alignToProjects([...ids, ...before.map((p) => p.id)]);
  }
  if (moving) {
    await moveProductEnterprise(existing.id, target, data);
    await prisma.activityLog.create({
      data: { entityType: "product", entityId: existing.id, action: "enterprise_moved", actorId: session.id, fromValue: existing.enterpriseId, toValue: target, message: "调整所属企业，产品下的项目一起转移" },
    });
  } else {
    await prisma.product.update({ where: { id: existing.id }, data });
  }
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: existing.id, action: "updated", actorId: session.id, message: "更新了产品信息" },
  });
  return result({ ok: true });
}

export async function DELETE(session: SessionUser, params: { id: string }) {
  try {
    await runAction(session, "product", params.id, "delete");
    return result({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) return result({ error: e.message }, { status: 400 });
    console.error("[删除产品]", e);
    return result({ error: "删除失败，请稍后重试" }, { status: 500 });
  }
}
