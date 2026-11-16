import { prisma } from "@pm-collab/db/prisma";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME, type OrgRow } from "./org-shared";

export * from "./org-shared";

/** 页面或接口首次用到组织时补齐系统组织（老库里没有这一行）。 */
export async function ensureSystemOrg() {
  return prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: {},
    create: { id: SYSTEM_ORG_ID, name: SYSTEM_ORG_NAME, type: "system", parentId: null },
  });
}

export async function listOrgs(): Promise<OrgRow[]> {
  await ensureSystemOrg();
  return prisma.organization.findMany({
    select: { id: true, name: true, type: true, parentId: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}
