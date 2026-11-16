/**
 * 端到端安全测试的测试账号。只能对测试库运行（PostgreSQL 库名里要有 test / verify / e2e / smoke）：
 * DATABASE_URL="postgresql://localhost:5432/pm_collab_verify" npx tsx scripts/security-e2e/seed.ts <输出 fix.json 的路径>
 * 测试库的建法：npx prisma migrate deploy，再用 scripts/migrate-sqlite-to-pg.ts 导入 demo.db 副本（见 run.mjs 文件头）。
 * 密码随机生成，写进 fix.json（权限 600），用完连同测试库一起删除。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { isTestDatabaseUrl } from "../test-db-guard.mjs";

const url = process.env.DATABASE_URL || "";
if (!isTestDatabaseUrl(url)) {
  console.error("拒绝运行：DATABASE_URL 必须指向测试库（PostgreSQL，库名里要有 test / verify / e2e / smoke）");
  process.exit(1);
}
const prisma = new PrismaClient();
(async () => {
  const creds: Record<string, string> = {};
  const mk = async (key: string, role: string, extra: object = {}) => {
    const pw = `Tt1${randomBytes(12).toString("hex")}`;
    creds[key] = pw;
    const email = `sec-${key}@verify.test`;
    return prisma.user.upsert({ where: { email }, update: {}, create: { email, name: `sec-${key}`, globalRole: role, passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: false, ...extra } });
  };
  for (const [k, r] of [["admin", "admin"], ["admin2", "admin"], ["manager", "manager"], ["manager2", "manager"], ["member", "member"], ["guest", "guest"], ["lock", "member"], ["pw", "member"], ["off", "member"], ["role", "member"], ["target", "member"], ["outsider", "member"], ["rootuser", "member"], ["member2", "member"]]) await mk(k, r);
  await mk("force", "member", { mustChangePassword: true });
  // 两个二级组织：manager 系列在甲企业的部门里，outsider 在乙企业；rootuser 直属 Weavi Space
  const root = "org_nova_collab";
  await prisma.organization.upsert({ where: { id: root }, update: {}, create: { id: root, name: "Weavi Space", type: "system" } });
  const mkOrg = (id: string, type: string, parentId: string) => prisma.organization.upsert({ where: { id }, update: {}, create: { id, name: id, type, parentId } });
  await mkOrg("sec_ent_a", "enterprise", root);
  await mkOrg("sec_dept_a", "department", "sec_ent_a");
  await mkOrg("sec_dept_a2", "department", "sec_ent_a");
  await mkOrg("sec_ent_b", "enterprise", root);
  await mkOrg("sec_dept_b", "department", "sec_ent_b");
  const place = (keys: string[], orgId: string) => prisma.user.updateMany({ where: { email: { in: keys.map((k) => `sec-${k}@verify.test`) } }, data: { orgId } });
  await place(["manager", "manager2", "role"], "sec_dept_a");
  await place(["target"], "sec_dept_a2");
  await place(["outsider"], "sec_dept_b");
  await place(["rootuser"], root);
  await place(["member2"], "sec_dept_b");
  // 乙企业的业务数据，跨企业测试用
  const out = (await prisma.user.findUnique({ where: { email: "sec-outsider@verify.test" } }))!;
  const entB = { enterpriseId: "sec_ent_b" };
  const prodB = await prisma.product.create({ data: { ...entB, name: "乙企业产品SEC", code: `SECB${Date.now() % 100000}`, ownerId: out.id } });
  const projB = await prisma.project.create({ data: { ...entB, name: "乙企业项目SEC", key: `SECB${Date.now() % 100000}`, systemName: "乙", productId: prodB.id, createdById: out.id, members: { create: { userId: out.id, role: "pm" } } } });
  const reqB = await prisma.requirement.create({ data: { title: "乙企业机密需求SEC", projectId: projB.id, status: "dev_in_progress", creatorId: out.id } });
  const bugB = await prisma.bug.create({ data: { title: "乙企业机密BugSEC", projectId: projB.id, creatorId: out.id } });
  const relB = await prisma.release.create({ data: { projectId: projB.id, version: "1.0.0", createdById: out.id } });
  const docB = await prisma.docPage.create({ data: { projectId: projB.id, title: "乙企业机密文档SEC", body: "<p>机密</p>", version: 1, creatorId: out.id, updatedById: out.id } });
  const attB = await prisma.attachment.create({ data: { ownerType: "requirement", ownerId: reqB.id, name: "b.png", mime: "image/png", size: 4, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), uploaderId: out.id } });
  const poolB = await prisma.requirement.create({ data: { title: "乙企业公共池需求SEC", projectId: null, status: "req_in_progress", creatorId: out.id } });
  // 甲企业的项目：manager 系列所在企业
  const mgr = (await prisma.user.findUnique({ where: { email: "sec-manager@verify.test" } }))!;
  const projA = await prisma.project.create({ data: { enterpriseId: "sec_ent_a", name: "甲企业项目SEC", key: `SECA${Date.now() % 100000}`, systemName: "甲", createdById: mgr.id, members: { create: { userId: mgr.id, role: "pm" } } } });
  const reqA = await prisma.requirement.create({ data: { title: "甲企业需求SEC", projectId: projA.id, status: "dev_in_progress", creatorId: mgr.id } });
  const poolA = await prisma.requirement.create({ data: { title: "甲企业公共池需求SEC", projectId: null, status: "req_in_progress", creatorId: mgr.id } });
  const mkBugA = (title: string) => prisma.bug.create({ data: { title, projectId: projA.id, creatorId: mgr.id } });
  const [bugA1, bugA2, bugA3] = [await mkBugA("甲企业待删Bug1"), await mkBugA("甲企业待删Bug2"), await mkBugA("甲企业待删Bug3")];
  const bugB2 = await prisma.bug.create({ data: { title: "乙企业矩阵开关Bug", projectId: projB.id, creatorId: out.id } });
  const b = { bugA1: bugA1.id, bugA2: bugA2.id, bugA3: bugA3.id, bugB2: bugB2.id, prodB: prodB.id, projB: projB.id, reqB: reqB.id, bugB: bugB.id, relB: relB.id, docB: docB.id, attB: attB.id, poolB: poolB.id, projA: projA.id, reqA: reqA.id, poolA: poolA.id };
  const req = await prisma.requirement.findFirst({ where: { projectId: { not: null }, deletedAt: null }, select: { id: true, projectId: true, title: true } });
  const prod = await prisma.product.findFirst({ where: { deletedAt: null }, select: { id: true } });
  writeFileSync(process.argv[2], JSON.stringify({ creds, req, prod, b }, null, 1), { mode: 0o600 });
  console.log(`账号 ${Object.keys(creds).length} 个；需求 ${req ? "有" : "无"}；产品 ${prod ? "有" : "无"}`);
})().finally(() => prisma.$disconnect());
