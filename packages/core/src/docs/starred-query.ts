import { prisma } from "@pm-collab/db/prisma";
import { spaceWhere } from "./docs-query";
export async function loadStars(user: {id:string;globalRole:string}) {
 return prisma.docPageStar.findMany({ where: { userId: user.id, page: { deletedAt: null, archivedAt: null, project: await spaceWhere(user) } }, include: { page: { include: { project: { select: { name: true } }, updatedBy: { select: { name: true, avatarUrl: true } }, creator: { select: { name: true, avatarUrl: true } } } } }, orderBy: { createdAt: "desc" } });
}
