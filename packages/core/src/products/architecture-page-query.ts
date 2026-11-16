import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";

export async function findArchitectureForPage(params: { id: string; archId: string }) {
  const arch = await prisma.productArchitecture.findFirst({ where: { id: params.archId, productId: params.id } });
  return arch;
}
export async function loadArchitectureDetails(session: SessionUser, arch: NonNullable<Awaited<ReturnType<typeof findArchitectureForPage>>>) {
  const [canManage, editor] = await Promise.all([
    can(session, "products.manage"),
    arch.updatedById ? prisma.user.findUnique({ where: { id: arch.updatedById }, select: { name: true } }) : null,
  ]);
  return { canManage, editor };
}
