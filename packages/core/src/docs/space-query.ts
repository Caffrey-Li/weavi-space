import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can, canMany } from "../permissions";
import { canViewSpace } from "./docs-query";
export async function spaceData(session: SessionUser, id: string) {
 const p = await prisma.project.findUnique({
  where: { id }, include: { resources: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, members: { include: { user: true }, orderBy: { createdAt: "asc" } }, _count: { select: { docPages: { where: { deletedAt: null, archivedAt: null } } } } },
 });
 if (!p || p.deletedAt) return {state:"notFound" as const};
 if (!(await canViewSpace(session, p.id))) return {state:"notFound" as const};
 const [perms, recent, parents] = await Promise.all([
  canMany(session, ["project.edit", "docs.edit"] as const, p.id),
  prisma.docPage.findMany({where:{projectId:p.id},include:{updatedBy:{select:{name:true,avatarUrl:true}},creator:{select:{name:true,avatarUrl:true}}},orderBy:{updatedAt:"desc"},take:5}),
  prisma.docPage.findMany({where:{projectId:p.id},select:{id:true,title:true,parentId:true}}),
 ]);
 const isProduct = p.status === "space";
 const product = isProduct && p.productId ? await prisma.product.findUnique({where:{id:p.productId},select:{id:true,name:true,owner:{select:{name:true}},projects:{where:{status:{not:"space"},deletedAt:null},select:{id:true,name:true,iconUrl:true}}}}) : null;
 // 产品空间包含下属项目的文档（T26）：只算当前用户能看的项目
 const childSpaces: { id: string; name: string; iconUrl: string | null; count: number; top: { id: string; title: string; draftTitle: string | null; version: number; updatedAt: Date }[] }[] = [];
 if (product) for (const x of product.projects) {
  if (!(await canViewSpace(session, x.id))) continue;
  const [count, top] = await Promise.all([prisma.docPage.count({ where: { projectId: x.id, deletedAt: null, archivedAt: null } }), prisma.docPage.findMany({ where: { projectId: x.id }, select: { id: true, title: true, draftTitle: true, version: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 3 })]);
  childSpaces.push({ ...x, count, top });
 }
 const spaceIds = [p.id, ...childSpaces.map((c) => c.id)];
 const spaceName = new Map<string, string>([[p.id, p.name], ...childSpaces.map((c) => [c.id, c.name] as [string, string])]);
 const recentAll = childSpaces.length ? await prisma.docPage.findMany({where:{projectId:{in:spaceIds}},include:{updatedBy:{select:{name:true,avatarUrl:true}},creator:{select:{name:true,avatarUrl:true}}},orderBy:{updatedAt:"desc"},take:8}) : recent;
 const parentsAll = childSpaces.length ? await prisma.docPage.findMany({where:{projectId:{in:spaceIds}},select:{id:true,title:true,parentId:true}}) : parents;
 const memberCanEdit = await Promise.all(p.members.map((m)=>can({id:m.user.id,globalRole:m.user.globalRole},"docs.edit",p.id)));
 return {state:"ok" as const,p,perms,recent:recentAll,parents:parentsAll,product,memberCanEdit,childSpaces,spaceName};
}