import { prisma } from "@pm-collab/db/prisma";
import { spaceWhere } from "./docs-query";
export async function loadRecent(user: {id:string;globalRole:string}) {
 return prisma.docPage.findMany({ where: { project: { status: { not: "archived" }, ...(await spaceWhere(user)) } }, include: { project: { select: { name: true } }, updatedBy: { select: { name: true, avatarUrl: true } }, creator: { select: { name: true, avatarUrl: true } } }, orderBy: { updatedAt: "desc" }, take: 40 });
}
