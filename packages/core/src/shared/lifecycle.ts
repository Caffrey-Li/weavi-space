import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { bugWhere, getAccess, productWhere, requirementWhere } from "../access";
import type { SessionUser } from "../auth";

/**
 * 归档与回收站（Figma 44）
 * - 归档：从列表、看板里隐藏，可随时恢复。产品 / 项目用 status=archived（prevStatus 记原状态），需求 / Bug / 文档用 archivedAt。
 * - 删除：进入回收站（deletedAt），全局查询默认排除（见 prisma.ts）；30 天后自动彻底删除。
 * - 级联：项目带上它的需求、Bug、文档；产品带上它的项目（及其内容）、直接挂在产品上的需求 / Bug、产品资料文档。
 *   下级记录的 archivedVia / deletedVia 写成 "project:<id>" / "product:<id>"，恢复时只还原同一来源的，自己单独处理过的不受影响。
 * - 删除需求 / Bug / 文档时如果还没归档，会顺带写 archivedAt（archivedVia="trash"），让旧代码里的 archivedAt 过滤也能排除它们；恢复时一并清掉。
 */
import { KIND_LABEL, type Kind } from "./lifecycle-shared";
export { KIND_LABEL, type Kind };
export const KINDS: Kind[] = ["product", "project", "requirement", "bug", "doc"];
export const RETENTION_DAYS = 30;

export class LifecycleError extends Error {}

const now = () => new Date();

/** 文档子树（含自己） */
async function docSubtree(rootId: string): Promise<string[]> {
  const out = [rootId];
  let frontier = [rootId];
  for (let i = 0; i < 50 && frontier.length; i++) {
    // 显式带上 deletedAt / archivedAt 条件，绕过默认过滤（已归档的子页面也要一起处理）
    const kids = await prisma.docPage.findMany({ where: { parentId: { in: frontier }, OR: [{ deletedAt: null }, { deletedAt: { not: null } }], AND: [{ OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }] }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !out.includes(id));
    out.push(...frontier);
  }
  return out;
}

async function projectIdsOfProduct(productId: string) {
  // 含已归档 / 产品资料空间；不含已经单独删除的
  const rows = await prisma.project.findMany({ where: { productId, deletedAt: null }, select: { id: true, status: true, archivedVia: true } });
  return rows;
}

// ———————————————————— 权限 ————————————————————

async function target(kind: Kind, id: string) {
  if (kind === "product") {
    const r = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, status: true, deletedAt: true, archivedVia: true } });
    return r && { id: r.id, name: r.name, archived: r.status === "archived", deleted: Boolean(r.deletedAt), projectId: null as string | null };
  }
  if (kind === "project") {
    const r = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, status: true, deletedAt: true } });
    if (r?.status === "space") return null;
    return r && { id: r.id, name: r.name, archived: r.status === "archived", deleted: Boolean(r.deletedAt), projectId: r.id };
  }
  if (kind === "requirement") {
    const r = await prisma.requirement.findUnique({ where: { id }, select: { id: true, title: true, archivedAt: true, archivedVia: true, deletedAt: true, projectId: true } });
    return r && { id: r.id, name: r.title, archived: Boolean(r.archivedAt) && r.archivedVia !== "trash", deleted: Boolean(r.deletedAt), projectId: r.projectId };
  }
  if (kind === "bug") {
    const r = await prisma.bug.findUnique({ where: { id }, select: { id: true, title: true, archivedAt: true, archivedVia: true, deletedAt: true, projectId: true } });
    return r && { id: r.id, name: r.title, archived: Boolean(r.archivedAt) && r.archivedVia !== "trash", deleted: Boolean(r.deletedAt), projectId: r.projectId };
  }
  const r = await prisma.docPage.findUnique({ where: { id }, select: { id: true, title: true, archivedAt: true, archivedVia: true, deletedAt: true, projectId: true } });
  return r && { id: r.id, name: r.title, archived: Boolean(r.archivedAt) && r.archivedVia !== "trash", deleted: Boolean(r.deletedAt), projectId: r.projectId };
}

/** 目标在数据范围内（含已在回收站的，这里要显式绕过默认过滤）。项目、文档的范围由 can(…, projectId) 判断 */
async function inScope(user: SessionUser, kind: Kind, id: string) {
  if (kind !== "product" && kind !== "requirement" && kind !== "bug") return true;
  const a = await getAccess(user);
  const any = { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] };
  if (kind === "product") return (await prisma.product.count({ where: { id, AND: [productWhere(a), any] } })) > 0;
  if (kind === "requirement") return (await prisma.requirement.count({ where: { id, AND: [requirementWhere(a), any] } })) > 0;
  return (await prisma.bug.count({ where: { id, AND: [bugWhere(a), any] } })) > 0;
}

export async function canManage(user: SessionUser, kind: Kind, projectId: string | null, action?: Action) {
  if (kind === "product") return can(user, "products.manage");
  if (kind === "project") return can(user, "project.edit", projectId);
  if (kind === "requirement") return can(user, "requirements.edit", projectId);
  // 删除和恢复单独授权：能改 Bug 不等于能删 Bug
  if (kind === "bug") return can(user, action === "delete" || action === "restore" ? "bugs.delete" : "bugs.edit", projectId);
  return can(user, "docs.edit", projectId);
}

// ———————————————————— 归档 ————————————————————

async function cascadeArchive(projectIds: string[], via: string, by: string, extra: { productId?: string } = {}) {
  const t = now();
  const ors = [{ projectId: { in: projectIds } }, ...(extra.productId ? [{ productId: extra.productId }] : [])];
  await prisma.requirement.updateMany({ where: { OR: ors, archivedAt: null, deletedAt: null }, data: { archivedAt: t, archivedById: by, archivedVia: via } });
  await prisma.bug.updateMany({ where: { OR: ors, archivedAt: null, deletedAt: null }, data: { archivedAt: t, archivedById: by, archivedVia: via } });
  await prisma.docPage.updateMany({ where: { projectId: { in: projectIds }, archivedAt: null, deletedAt: null }, data: { archivedAt: t, archivedById: by, archivedVia: via } });
}
async function cascadeUnarchive(via: string) {
  const clear = { archivedAt: null, archivedById: null, archivedVia: null };
  await prisma.requirement.updateMany({ where: { archivedVia: via, deletedAt: null }, data: clear });
  await prisma.bug.updateMany({ where: { archivedVia: via, deletedAt: null }, data: clear });
  await prisma.docPage.updateMany({ where: { archivedVia: via, deletedAt: null }, data: clear });
}

export async function archive(kind: Kind, id: string, by: string) {
  const t = now();
  if (kind === "requirement") await prisma.requirement.update({ where: { id }, data: { archivedAt: t, archivedById: by, archivedVia: "self" } });
  else if (kind === "bug") await prisma.bug.update({ where: { id }, data: { archivedAt: t, archivedById: by, archivedVia: "self" } });
  else if (kind === "doc") {
    const ids = await docSubtree(id);
    await prisma.docPage.update({ where: { id }, data: { archivedAt: t, archivedById: by, archivedVia: "self" } });
    await prisma.docPage.updateMany({ where: { id: { in: ids.filter((x) => x !== id) }, archivedAt: null }, data: { archivedAt: t, archivedById: by, archivedVia: `doc:${id}` } });
  } else if (kind === "project") {
    const p = await prisma.project.findUnique({ where: { id }, select: { status: true } });
    await prisma.project.update({ where: { id }, data: { prevStatus: p?.status === "archived" ? "active" : p?.status, status: "archived", archivedAt: t, archivedById: by, archivedVia: "self" } });
    await cascadeArchive([id], `project:${id}`, by);
  } else {
    const p = await prisma.product.findUnique({ where: { id }, select: { status: true } });
    await prisma.product.update({ where: { id }, data: { prevStatus: p?.status === "archived" ? "maintaining" : p?.status, status: "archived", archivedAt: t, archivedById: by, archivedVia: "self" } });
    const projects = await projectIdsOfProduct(id);
    for (const x of projects) {
      if (x.status === "archived" || x.status === "space") continue;
      await prisma.project.update({ where: { id: x.id }, data: { prevStatus: x.status, status: "archived", archivedAt: t, archivedById: by, archivedVia: `product:${id}` } });
    }
    await cascadeArchive(projects.map((x) => x.id), `product:${id}`, by, { productId: id });
  }
}

export async function unarchive(kind: Kind, id: string) {
  const clear = { archivedAt: null, archivedById: null, archivedVia: null };
  if (kind === "requirement") await prisma.requirement.update({ where: { id }, data: clear });
  else if (kind === "bug") await prisma.bug.update({ where: { id }, data: clear });
  else if (kind === "doc") {
    await prisma.docPage.update({ where: { id }, data: clear });
    await prisma.docPage.updateMany({ where: { archivedVia: `doc:${id}` }, data: clear });
  } else if (kind === "project") {
    const p = await prisma.project.findUnique({ where: { id }, select: { prevStatus: true } });
    await prisma.project.update({ where: { id }, data: { ...clear, status: p?.prevStatus && p.prevStatus !== "archived" ? p.prevStatus : "active", prevStatus: null } });
    await cascadeUnarchive(`project:${id}`);
  } else {
    const p = await prisma.product.findUnique({ where: { id }, select: { prevStatus: true } });
    await prisma.product.update({ where: { id }, data: { ...clear, status: p?.prevStatus && p.prevStatus !== "archived" ? p.prevStatus : "maintaining", prevStatus: null } });
    const projects = await prisma.project.findMany({ where: { archivedVia: `product:${id}` }, select: { id: true, prevStatus: true } });
    for (const x of projects) {
      await prisma.project.update({ where: { id: x.id }, data: { ...clear, status: x.prevStatus && x.prevStatus !== "archived" ? x.prevStatus : "active", prevStatus: null } });
    }
    await cascadeUnarchive(`product:${id}`);
  }
}

// ———————————————————— 删除 / 恢复 ————————————————————

async function softDelete(model: "requirement" | "bug" | "docPage", where: object, via: string, by: string) {
  const t = now();
  const data = { deletedAt: t, deletedById: by, deletedVia: via };
  // 还没归档的顺带写 archivedAt（archivedVia=trash），已归档的保持原样
  const d = prisma[model] as unknown as { updateMany: (a: object) => Promise<unknown> };
  await d.updateMany({ where: { AND: [where, { deletedAt: null, archivedAt: null }] }, data: { ...data, archivedAt: t, archivedVia: "trash" } });
  await d.updateMany({ where: { AND: [where, { deletedAt: null }] }, data });
}
async function softRestore(model: "requirement" | "bug" | "docPage", where: object) {
  const d = prisma[model] as unknown as { updateMany: (a: object) => Promise<unknown> };
  await d.updateMany({ where: { AND: [where, { archivedVia: "trash" }] }, data: { archivedAt: null, archivedById: null, archivedVia: null } });
  await d.updateMany({ where, data: { deletedAt: null, deletedById: null, deletedVia: null } });
}

export async function trash(kind: Kind, id: string, by: string) {
  const t = now();
  if (kind === "requirement") await softDelete("requirement", { id }, "self", by);
  else if (kind === "bug") await softDelete("bug", { id }, "self", by);
  else if (kind === "doc") {
    const ids = await docSubtree(id);
    await softDelete("docPage", { id }, "self", by);
    await softDelete("docPage", { id: { in: ids.filter((x) => x !== id) } }, `doc:${id}`, by);
  } else if (kind === "project") {
    await prisma.project.update({ where: { id }, data: { deletedAt: t, deletedById: by, deletedVia: "self" } });
    const via = `project:${id}`;
    await softDelete("requirement", { projectId: id }, via, by);
    await softDelete("bug", { projectId: id }, via, by);
    await softDelete("docPage", { projectId: id }, via, by);
  } else {
    await prisma.product.update({ where: { id }, data: { deletedAt: t, deletedById: by, deletedVia: "self" } });
    const via = `product:${id}`;
    const projects = await projectIdsOfProduct(id);
    const ids = projects.map((x) => x.id);
    await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: t, deletedById: by, deletedVia: via } });
    await softDelete("requirement", { OR: [{ projectId: { in: ids } }, { productId: id }] }, via, by);
    await softDelete("bug", { OR: [{ projectId: { in: ids } }, { productId: id }] }, via, by);
    await softDelete("docPage", { projectId: { in: ids } }, via, by);
  }
}

export async function restore(kind: Kind, id: string) {
  if (kind === "requirement") await softRestore("requirement", { id });
  else if (kind === "bug") await softRestore("bug", { id });
  else if (kind === "doc") {
    await softRestore("docPage", { id });
    await softRestore("docPage", { deletedVia: `doc:${id}` });
  } else if (kind === "project") {
    await prisma.project.update({ where: { id }, data: { deletedAt: null, deletedById: null, deletedVia: null } });
    const via = `project:${id}`;
    await softRestore("requirement", { deletedVia: via });
    await softRestore("bug", { deletedVia: via });
    await softRestore("docPage", { deletedVia: via });
  } else {
    await prisma.product.update({ where: { id }, data: { deletedAt: null, deletedById: null, deletedVia: null } });
    const via = `product:${id}`;
    await prisma.project.updateMany({ where: { deletedVia: via }, data: { deletedAt: null, deletedById: null, deletedVia: null } });
    await softRestore("requirement", { deletedVia: via });
    await softRestore("bug", { deletedVia: via });
    await softRestore("docPage", { deletedVia: via });
  }
}

// ———————————————————— 彻底删除 ————————————————————

async function purgeRequirements(where: object) {
  const rows = await prisma.requirement.findMany({ where: { AND: [where, { deletedAt: { not: null } }] }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  await prisma.requirement.updateMany({ where: { parentId: { in: ids }, deletedAt: undefined }, data: { parentId: null } });
  await prisma.bug.updateMany({ where: { requirementId: { in: ids }, deletedAt: undefined }, data: { requirementId: null } });
  await prisma.attachment.deleteMany({ where: { ownerType: "requirement", ownerId: { in: ids } } });
  await prisma.requirement.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
}
async function purgeBugs(where: object) {
  const rows = await prisma.bug.findMany({ where: { AND: [where, { deletedAt: { not: null } }] }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  await prisma.attachment.deleteMany({ where: { ownerType: "bug", ownerId: { in: ids } } });
  await prisma.bug.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
}
async function purgeProject(id: string) {
  await purgeRequirements({ projectId: id });
  await purgeBugs({ projectId: id });
  // 项目里没删除的需求 / Bug（不会出现：删除项目时一并进了回收站）兜底解除关联
  await prisma.requirement.updateMany({ where: { projectId: id, deletedAt: undefined }, data: { projectId: null } });
  await prisma.bug.updateMany({ where: { projectId: id, deletedAt: undefined }, data: { projectId: null } });
  await prisma.docGroup.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } }); // 成员、发版、资料链接、背景图、文档页面随项目级联删除
}

/** 彻底删除回收站里的一项（连同随它进入回收站的下级） */
export async function purge(kind: Kind, id: string) {
  if (kind === "requirement") await purgeRequirements({ OR: [{ id }, { deletedVia: `requirement:${id}` }] });
  else if (kind === "bug") await purgeBugs({ id });
  else if (kind === "doc") await prisma.docPage.deleteMany({ where: { id, deletedAt: { not: null } } }); // 子页面随父页面级联删除
  else if (kind === "project") await purgeProject(id);
  else {
    const via = `product:${id}`;
    const projects = await prisma.project.findMany({ where: { deletedVia: via }, select: { id: true } });
    for (const p of projects) await purgeProject(p.id);
    await purgeRequirements({ deletedVia: via });
    await purgeBugs({ deletedVia: via });
    await prisma.project.updateMany({ where: { productId: id, deletedAt: undefined }, data: { productId: null } });
    await prisma.product.delete({ where: { id } });
  }
}

/** 回收站超过保留期的自动彻底删除（定时检查，失败的留到下次） */
async function purgeExpiredOnce(retryFailures: boolean) {
  const before = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const roots: [Kind, { id: string }[]][] = [
    ["doc", await prisma.docPage.findMany({ where: { deletedVia: "self", deletedAt: { lt: before }, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }, select: { id: true } })],
    ["bug", await prisma.bug.findMany({ where: { deletedVia: "self", deletedAt: { lt: before } }, select: { id: true } })],
    ["requirement", await prisma.requirement.findMany({ where: { deletedVia: "self", deletedAt: { lt: before } }, select: { id: true } })],
    ["project", await prisma.project.findMany({ where: { deletedVia: "self", deletedAt: { lt: before } }, select: { id: true } })],
    ["product", await prisma.product.findMany({ where: { deletedVia: "self", deletedAt: { lt: before } }, select: { id: true } })],
  ];
  let n = 0;
  let failed = false;
  for (const [kind, rows] of roots) {
    for (const r of rows) {
      try {
        await purge(kind, r.id);
        n++;
      } catch (e) {
        failed = true;
        console.error(`[回收站] 自动清除 ${kind} ${r.id} 失败`, e);
      }
    }
  }
  if (failed && retryFailures) throw new Error("部分回收站内容清理失败");
  return n;
}

export async function purgeExpired() {
  return purgeExpiredOnce(false);
}

export async function purgeExpiredForQueue() {
  return purgeExpiredOnce(true);
}

// ———————————————————— 对外动作 ————————————————————

export type Action = "archive" | "unarchive" | "delete" | "restore" | "purge";

export async function runAction(user: SessionUser, kind: Kind, id: string, action: Action) {
  const t = await target(kind, id);
  if (!t) throw new LifecycleError(`${KIND_LABEL[kind]}不存在`);
  if (action === "purge") {
    if (user.globalRole !== "admin") throw new LifecycleError("只有管理员可以彻底删除");
    if (!t.deleted) throw new LifecycleError("只能彻底删除回收站里的内容");
  } else if (!(await inScope(user, kind, id)) || !(await canManage(user, kind, t.projectId, action))) throw new LifecycleError(`无权限操作这个${KIND_LABEL[kind]}`);
  if (action === "archive") {
    if (t.deleted) throw new LifecycleError("已在回收站中，请先恢复");
    if (t.archived) throw new LifecycleError("已经归档了");
    await archive(kind, id, user.id);
  } else if (action === "unarchive") {
    if (!t.archived) throw new LifecycleError("没有归档");
    await unarchive(kind, id);
  } else if (action === "delete") {
    if (t.deleted) throw new LifecycleError("已经在回收站里了");
    await trash(kind, id, user.id);
  } else if (action === "restore") {
    if (!t.deleted) throw new LifecycleError("不在回收站里");
    await restore(kind, id);
  } else await purge(kind, id);
  const verb = { archive: "归档了", unarchive: "取消归档了", delete: "删除了（移入回收站）", restore: "从回收站恢复了", purge: "彻底删除了" }[action];
  await prisma.activityLog.create({
    data: { entityType: kind === "doc" ? "doc" : kind, entityId: id, action: `lifecycle_${action}`, actorId: user.id, message: `${verb}${KIND_LABEL[kind]}「${t.name}」` },
  });
  return { name: t.name };
}
