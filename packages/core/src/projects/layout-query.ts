import { prisma } from "@pm-collab/db/prisma";

export async function findProjectLayout(id: string) {
  return prisma.project.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
}

export async function findProjectForPlans(id: string) {
  return prisma.project.findUnique({ where: { id }, select: { id: true, name: true } });
}
