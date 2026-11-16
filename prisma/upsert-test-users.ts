/**
 * 安全补齐本地测试账号：仅 upsert users，不删除项目/需求等业务数据。
 * 密码统一：Admin123!
 *
 * 用法：npx tsx prisma/upsert-test-users.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeToWipe } from "./guard-destructive";

// 测试账号的密码是公开的 Admin123!：线上库直接拒绝
if (process.env.NODE_ENV === "production" || process.env.TURSO_DATABASE_URL) assertSafeToWipe("写入公开密码的测试账号");

const prisma = new PrismaClient();

const PASSWORD = "Admin123!";

const TEST_USERS: {
  email: string;
  name: string;
  globalRole: string;
  position?: string;
}[] = [
  { email: "admin@local", name: "系统管理员", globalRole: "admin" },
  { email: "pm@local", name: "张项目", globalRole: "member", position: "pm" },
  { email: "tech@local", name: "李技术", globalRole: "member", position: "tech_lead" },
  { email: "director@local", name: "王总监", globalRole: "manager" },
  { email: "product@local", name: "赵产品", globalRole: "member", position: "product" },
  { email: "fe@local", name: "钱前端", globalRole: "member", position: "frontend" },
  { email: "be@local", name: "孙后端", globalRole: "member", position: "backend" },
  { email: "qa@local", name: "周测试", globalRole: "member", position: "qa" },
];

async function main() {
  const before = {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    requirements: await prisma.requirement.count(),
  };

  const hash = await bcrypt.hash(PASSWORD, 10);
  const upserted: { email: string; id: string; created: boolean }[] = [];

  for (const u of TEST_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: hash,
        globalRole: u.globalRole,
        position: u.position || null,
        isActive: true,
        mustChangePassword: false,
      },
      update: {
        // 不改已有真实姓名以外的业务字段时：仅确保可登录
        name: existing ? existing.name : u.name,
        passwordHash: hash,
        globalRole: u.globalRole,
        position: u.position || null,
        isActive: true,
        mustChangePassword: false,
      },
    });
    // 对新建的用 seed 名；已存在的保留原 name，但上面 update 用了 existing.name
    // 若是新建，name 已是 seed 名。再校正：仅当新建时 name=u.name（已满足）
    if (!existing) {
      // ensure seed display name for brand-new locals
      await prisma.user.update({ where: { id: row.id }, data: { name: u.name } });
    }
    upserted.push({ email: u.email, id: row.id, created: !existing });
  }

  // 确保非 admin 岗位在权限矩阵上 users.manage=false（有则更新，无则创建）
  const nonAdminRoles = ["pm", "tech_lead", "director", "product", "frontend", "backend", "member"];
  for (const role of nonAdminRoles) {
    await prisma.rolePermission.upsert({
      where: { scope_role_feature: { scope: "project", role, feature: "users.manage" } },
      create: { scope: "project", role, feature: "users.manage", allowed: false },
      update: { allowed: false },
    });
  }
  await prisma.rolePermission.upsert({
    where: { scope_role_feature: { scope: "project", role: "admin", feature: "users.manage" } },
    create: { scope: "project", role: "admin", feature: "users.manage", allowed: true },
    update: { allowed: true },
  });

  // 可选：把测试账号挂到已有项目（按 key），不删旧成员
  const projects = await prisma.project.findMany({ select: { id: true, key: true } });
  const byEmail = Object.fromEntries(
    (await prisma.user.findMany({ where: { email: { in: TEST_USERS.map((x) => x.email) } } })).map((u) => [
      u.email,
      u,
    ])
  );

  const membershipPlan: { projectKey: string; email: string; role: string }[] = [];
  for (const p of projects) {
    // 各项目都挂上全套测试角色，便于验收；已存在则跳过
    for (const u of TEST_USERS) {
      if (u.email === "admin@local") continue;
      membershipPlan.push({ projectKey: p.key, email: u.email, role: u.position || "member" });
    }
  }

  let membersAdded = 0;
  for (const m of membershipPlan) {
    const project = projects.find((p) => p.key === m.projectKey);
    const user = byEmail[m.email];
    if (!project || !user) continue;
    const exists = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
    });
    if (exists) continue;
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: m.role },
    });
    membersAdded++;
  }

  const after = {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    requirements: await prisma.requirement.count(),
  };

  console.log(JSON.stringify({ before, after, upserted, membersAdded, password: PASSWORD }, null, 2));
  if (after.projects !== before.projects || after.requirements !== before.requirements) {
    throw new Error("业务数据数量变化，中止检查失败");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
