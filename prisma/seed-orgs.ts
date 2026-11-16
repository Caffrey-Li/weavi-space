/**
 * 组织架构示例：系统组织 Weavi Space › 示例企业 › 部门，并把测试账号分到部门。
 * 只在还没有企业时补充，不删数据；seed.ts 末尾会调用。
 *
 * 单独使用：DATABASE_URL=postgresql://localhost:5432/pm_collab_demo npx tsx prisma/seed-orgs.ts
 */
import { PrismaClient } from "@prisma/client";

const SYSTEM_ORG_ID = "org_nova_collab";

export async function seedOrgs(prisma: PrismaClient) {
  await prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: {},
    create: { id: SYSTEM_ORG_ID, name: "Weavi Space", type: "system" },
  });
  if (await prisma.organization.count({ where: { type: "enterprise" } })) return 0;

  const ent = await prisma.organization.create({ data: { name: "星河科技", type: "enterprise", parentId: SYSTEM_ORG_ID } });
  const dept = async (name: string, parentId: string, sortOrder: number) =>
    prisma.organization.create({ data: { name, type: "department", parentId, sortOrder } });
  const mgmt = await dept("管理层", ent.id, 0);
  const product = await dept("产品部", ent.id, 1);
  const rd = await dept("研发部", ent.id, 2);
  const fe = await dept("前端组", rd.id, 0);
  const be = await dept("后端组", rd.id, 1);
  const qa = await dept("测试部", ent.id, 3);

  const assign: Record<string, string> = {
    "director@local": mgmt.id,
    "pm@local": product.id,
    "product@local": product.id,
    "tech@local": rd.id,
    "fe@local": fe.id,
    "be@local": be.id,
    "qa@local": qa.id,
  };
  for (const [email, orgId] of Object.entries(assign)) {
    await prisma.user.updateMany({ where: { email }, data: { orgId } });
  }
  await prisma.user.updateMany({ where: { orgId: null }, data: { orgId: SYSTEM_ORG_ID } });
  return 7;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedOrgs(prisma)
    .then((n) => console.log(`Orgs: ${n} created`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
