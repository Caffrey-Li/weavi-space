import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { cleanEnvs } from "../shared/product-envs";
import { alignToProjects } from "../shared/cascade";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, productVisible, productWhere, projectWhere } from "../access";
import { PRODUCT_STATUS, joinedProductWhere } from "../shared/products";
import { EnterpriseError, enterpriseForNew } from "../shared/enterprise";

export async function GET(session: SessionUser) {
  const scope = { AND: [productWhere(await getAccess(session))] };
  const [products, all, mine, joined, archived] = await Promise.all([
    prisma.product.findMany({
      where: { status: { not: "archived" }, ...scope },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        nodes: { select: { id: true, parentId: true, type: true, name: true, code: true, description: true, sortOrder: true } },
      },
    }),
    prisma.product.count({ where: { status: { not: "archived" }, ...scope } }),
    prisma.product.count({ where: { status: { not: "archived" }, ownerId: session.id } }),
    prisma.product.count({ where: { status: { not: "archived" }, AND: [productWhere(await getAccess(session)), joinedProductWhere(session.id)] } }),
    prisma.product.count({ where: { status: "archived", ...scope } }),
  ]);
  return result({ products, counts: { all, mine, joined, archived } });
}

export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const name = String(body.name || "").trim().slice(0, 60);
  const code = String(body.code || "").trim().toUpperCase().slice(0, 20);
  if (!name) return result({ error: "请填写产品名称" }, { status: 400 });
  if (!/^[A-Z][A-Z0-9]{1,19}$/.test(code)) {
    return result({ error: "产品编码需以大写字母开头，2–20 位大写字母和数字" }, { status: 400 });
  }
  if (!(await can(session, "products.manage"))) return result({ error: "无权限维护产品" }, { status: 403 });
  if (await prisma.product.findUnique({ where: { code } })) {
    return result({ error: `编码 ${code} 已被其他产品使用` }, { status: 400 });
  }
  const ownerId = body.ownerId ? String(body.ownerId) : null;
  if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, isActive: true } }))) {
    return result({ error: "负责人不存在或已停用" }, { status: 400 });
  }
  const envRes = cleanEnvs(body.environments);
  if (envRes.error) return result({ error: envRes.error }, { status: 400 });
  let enterpriseId: string | null;
  try {
    enterpriseId = await enterpriseForNew(session, { requested: body.enterpriseId });
  } catch (e) {
    if (e instanceof EnterpriseError) return result({ error: e.message }, { status: 400 });
    throw e;
  }
  const last = await prisma.product.aggregate({ _max: { sortOrder: true } });
  const product = await prisma.product.create({
    data: {
      enterpriseId,
      name,
      code,
      description: body.description ? String(body.description).slice(0, 500) : null,
      ownerId,
      status: PRODUCT_STATUS.some((s) => s.key === body.status) ? String(body.status) : "maintaining",
      environments: envRes.envs.length ? JSON.stringify(envRes.envs) : null,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });
  const copyFrom = body.copyFrom ? String(body.copyFrom) : null;
  if (copyFrom && (await productVisible(session, copyFrom))) {
    const src = await prisma.productNode.findMany({ where: { productId: copyFrom }, orderBy: { sortOrder: "asc" } });
    const idMap = new Map<string, string>();
    // 按层级逐层复制，保证上级先建
    let pending = src;
    while (pending.length) {
      const ready = pending.filter((n) => !n.parentId || idMap.has(n.parentId));
      if (!ready.length) break;
      for (const n of ready) {
        const created = await prisma.productNode.create({
          data: {
            productId: product.id,
            parentId: n.parentId ? idMap.get(n.parentId)! : null,
            type: n.type,
            name: n.name,
            code: n.code,
            description: n.description,
            sortOrder: n.sortOrder,
          },
        });
        idMap.set(n.id, created.id);
      }
      pending = pending.filter((n) => !idMap.has(n.id));
    }
  }
  if (Array.isArray(body.projectIds) && body.projectIds.length) {
    const scope = projectWhere(await getAccess(session));
    const ids = (await prisma.project.findMany({ where: { ...scope, id: { in: body.projectIds.map(String) } }, select: { id: true } })).map((p) => p.id);
    await prisma.project.updateMany({ where: { id: { in: ids } }, data: { productId: product.id } });
    await alignToProjects(ids);
  }
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: product.id, action: "created", actorId: session.id, message: `新建产品「${name}」` },
  });
  return result({ id: product.id });
}
