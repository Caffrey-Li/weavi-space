import { prisma } from "@pm-collab/db/prisma";
export async function loadEdit(pageId: string) {
 return prisma.docPage.findUnique({ where: { id: pageId }, include: { project: { select: { name: true, iconUrl: true } }, links: { where: { source: "manual" }, orderBy: { createdAt: "asc" } } } });
}
