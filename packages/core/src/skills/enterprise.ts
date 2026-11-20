import { prisma } from "@pm-collab/db/prisma";
import { SYSTEM_ORG_ID, level2OrgId, listOrgs } from "../shared/org";

/** T35：企业 skill 的查询（单独成文件，便于单元测试替换） */

/** 账号所属企业 id（不属于企业 = ""） */
export async function enterpriseOfUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  return level2OrgId(await listOrgs(), u?.orgId || SYSTEM_ORG_ID) || "";
}

/** 本企业的企业 skill（定制内置的和新增的） */
export async function enterpriseSkills(enterpriseId: string) {
  return prisma.userSkill.findMany({ where: { scope: "enterprise", enterpriseId }, orderBy: { createdAt: "asc" } });
}

/** 本企业对某个内置能力的定制；没有返回 null */
export async function enterpriseOverride(enterpriseId: string, key: string) {
  return prisma.userSkill.findFirst({ where: { scope: "enterprise", enterpriseId, overrides: key } });
}
