import { Prisma } from "@prisma/client";
import { prisma } from "@pm-collab/db/prisma";

/**
 * 级联规则：产品 › 项目 › 需求 / Bug。
 * 需求、Bug 一旦归属项目，所属产品就等于该项目的产品（项目没挂产品时保持原样，未进项目的需求可自选产品）；
 * 功能模块必须属于这个产品，不属于时清空。可重复执行。
 * projectIds 不传时校正全部数据（服务启动时执行一次）。
 */
export async function alignToProjects(projectIds?: (string | null | undefined)[]) {
  const ids = projectIds ? Array.from(new Set(projectIds.filter((x): x is string => Boolean(x)))) : null;
  if (ids && !ids.length) return;
  const scope = ids ? Prisma.sql` AND x."projectId" IN (${Prisma.join(ids)})` : Prisma.empty;
  for (const name of ["requirements", "bugs"] as const) {
    const table = Prisma.raw(`"${name}"`);
    await prisma.$executeRaw`UPDATE ${table} AS x SET "productId" = (SELECT p."productId" FROM "projects" p WHERE p."id" = x."projectId")
       WHERE x."projectId" IS NOT NULL${scope}
         AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = x."projectId" AND p."productId" IS NOT NULL)
         AND (x."productId" IS NULL OR x."productId" <> (SELECT p."productId" FROM "projects" p WHERE p."id" = x."projectId"))`;
    await prisma.$executeRaw`UPDATE ${table} AS x SET "productNodeId" = NULL
       WHERE x."productNodeId" IS NOT NULL${scope}
         AND NOT EXISTS (SELECT 1 FROM "product_nodes" n WHERE n."id" = x."productNodeId" AND n."productId" = x."productId")`;
  }
}

/** 需求 / Bug 写入前：项目挂了产品时，返回强制的产品 id（否则 null 表示不限制） */
export async function projectProductId(projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { productId: true } });
  return p?.productId ?? null;
}
