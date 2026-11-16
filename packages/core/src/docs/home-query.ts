import { prisma } from "@pm-collab/db/prisma";
import { spaceWhere } from "./docs-query";
export async function docsHomeSpace(user: {id:string;globalRole:string}) {
 return prisma.project.findFirst({ where: { status: { not: "archived" }, ...(await spaceWhere(user)) }, orderBy: { createdAt: "asc" }, select: { id: true } });
}
