import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedDocs } from "./seed-docs";
import { seedOrgs } from "./seed-orgs";
import { seedProductDetails, seedProducts } from "./seed-products";
import { assertSafeToWipe } from "./guard-destructive";
import { DEFAULT_POSITIONS, DEFAULT_ROLES, defaultRoleAllow } from "../apps/web/src/lib/roles-shared";

const prisma = new PrismaClient();

async function main() {
  // 会清空全部数据：线上库、真实数据库（pm_collab）直接拒绝
  assertSafeToWipe("db:seed 清空并重建数据");
  await prisma.rolePermission.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.requirementComment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.releaseRequirement.deleteMany();
  await prisma.release.deleteMany();
  await prisma.bug.deleteMany();
  await prisma.requirementAssignee.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  // 功能结构随产品级联删除
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  // 组织是树（上级 Restrict），从叶子一层层删
  while (await prisma.organization.count()) {
    await prisma.organization.deleteMany({ where: { children: { none: {} } } });
  }

  const hash = await bcrypt.hash("Admin123!", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@local",
      name: "系统管理员",
      passwordHash: hash,
      globalRole: "admin",
      mustChangePassword: false,
    },
  });

  const users = await Promise.all([
    prisma.user.create({
      data: { email: "pm@local", name: "张项目", passwordHash: hash, globalRole: "member", position: "pm", mustChangePassword: false },
    }),
    prisma.user.create({
      data: { email: "tech@local", name: "李技术", passwordHash: hash, globalRole: "member", position: "tech_lead", mustChangePassword: false },
    }),
    prisma.user.create({
      data: { email: "director@local", name: "王总监", passwordHash: hash, globalRole: "manager", mustChangePassword: false },
    }),
    prisma.user.create({
      data: { email: "product@local", name: "赵产品", passwordHash: hash, globalRole: "member", position: "product", mustChangePassword: false },
    }),
    prisma.user.create({
      data: { email: "fe@local", name: "钱前端", passwordHash: hash, globalRole: "member", position: "frontend", mustChangePassword: false },
    }),
    prisma.user.create({
      data: { email: "be@local", name: "孙后端", passwordHash: hash, globalRole: "member", position: "backend", mustChangePassword: false },
    }),
  ]);

  const [pm, tech, director, product, fe, be] = users;

  const plannedPast = new Date();
  plannedPast.setDate(plannedPast.getDate() - 3);
  const plannedFuture = new Date();
  plannedFuture.setDate(plannedFuture.getDate() + 20);
  const plannedMid = new Date();
  plannedMid.setDate(plannedMid.getDate() + 10);

  const web = await prisma.project.create({
    data: {
      name: "官网改版",
      key: "WEB",
      systemName: "公司官网",
      description: "官网改版与内容管理后台（示例数据）",
      status: "active",
      plannedEndAt: plannedPast,
      createdById: admin.id,
      launchNotes: "分两期上线，一期首页和产品页、二期内容后台",
    },
  });

  const app = await prisma.project.create({
    data: {
      name: "移动端 App",
      key: "APP",
      systemName: "移动端 App 2.0",
      description: "iOS / Android 客户端迭代",
      status: "active",
      plannedEndAt: plannedMid,
      createdById: pm.id,
    },
  });

  const dataHub = await prisma.project.create({
    data: {
      name: "数据中台",
      key: "DATA",
      systemName: "数据中台",
      description: "指标口径、报表与数据接口",
      status: "active",
      plannedEndAt: plannedFuture,
      createdById: tech.id,
    },
  });

  const memberData = [
    { projectId: web.id, userId: admin.id, role: "pm" },
    { projectId: web.id, userId: pm.id, role: "pm" },
    { projectId: web.id, userId: tech.id, role: "tech_lead" },
    { projectId: web.id, userId: product.id, role: "product" },
    { projectId: web.id, userId: fe.id, role: "frontend" },
    { projectId: web.id, userId: be.id, role: "backend" },
    { projectId: web.id, userId: director.id, role: "member" },
    { projectId: app.id, userId: pm.id, role: "pm" },
    { projectId: app.id, userId: product.id, role: "product" },
    { projectId: app.id, userId: fe.id, role: "frontend" },
    { projectId: app.id, userId: be.id, role: "backend" },
    { projectId: app.id, userId: tech.id, role: "tech_lead" },
    { projectId: dataHub.id, userId: tech.id, role: "tech_lead" },
    { projectId: dataHub.id, userId: pm.id, role: "pm" },
    { projectId: dataHub.id, userId: fe.id, role: "frontend" },
    { projectId: dataHub.id, userId: be.id, role: "backend" },
    { projectId: dataHub.id, userId: product.id, role: "product" },
  ];
  await prisma.projectMember.createMany({ data: memberData });

  const reqEnd1 = new Date();
  reqEnd1.setDate(reqEnd1.getDate() + 5);
  const reqEnd2 = new Date();
  reqEnd2.setDate(reqEnd2.getDate() + 12);

  const r1 = await prisma.requirement.create({
    data: {
      title: "跨项目筛选需求池",
      summary: "支持按项目/状态/责任人筛选公共需求池",
      docUrl: "https://feishu.cn/docx/demo-req-pool-filter",
      projectId: web.id,
      status: "req_in_progress",
      priority: "p1",
      creatorId: product.id,
      boardOrder: 1,
      plannedEndAt: reqEnd1,
      tags: JSON.stringify(["筛选", "需求池"]),
    },
  });
  const r2 = await prisma.requirement.create({
    data: {
      title: "发版计划字段补齐",
      summary: "发版详情补充冻结/上线动作与关联需求",
      docUrl: "https://feishu.cn/docx/demo-release-fields",
      projectId: web.id,
      status: "dev_done",
      priority: "p1",
      creatorId: pm.id,
      boardOrder: 1,
      plannedEndAt: reqEnd1,
    },
  });
  const r3 = await prisma.requirement.create({
    data: {
      title: "Bug 看板独立列",
      summary: "独立 Bug 看板：Open/进行中/已解决/已关闭",
      docUrl: "https://feishu.cn/docx/demo-bug-board",
      projectId: web.id,
      status: "req_in_progress",
      priority: "p2",
      creatorId: tech.id,
      boardOrder: 1,
      plannedEndAt: reqEnd2,
    },
  });
  const r4 = await prisma.requirement.create({
    data: {
      title: "App 内搜索支持拼音",
      summary: "搜索框支持拼音和首字母匹配",
      docUrl: "https://feishu.cn/docx/demo-app-pinyin-search",
      projectId: app.id,
      status: "req_in_progress",
      priority: "p0",
      creatorId: product.id,
      boardOrder: 1,
      plannedEndAt: reqEnd2,
    },
  });
  const r5 = await prisma.requirement.create({
    data: {
      title: "数据接口鉴权改造",
      summary: "对外数据接口改用令牌鉴权",
      docUrl: "https://feishu.cn/docx/demo-data-api-auth",
      projectId: dataHub.id,
      status: "req_in_progress",
      priority: "p2",
      creatorId: pm.id,
      boardOrder: 1,
      plannedEndAt: reqEnd2,
    },
  });
  const r6 = await prisma.requirement.create({
    data: {
      title: "未归属池：登录失败态文案",
      summary: "公共池未挂项目的需求示例",
      docUrl: "https://feishu.cn/docx/demo-login-error",
      status: "req_in_progress",
      priority: "p3",
      creatorId: product.id,
      boardOrder: 0,
    },
  });
  const r7 = await prisma.requirement.create({
    data: {
      title: "首页改版",
      summary: "新版首页与导航",
      projectId: web.id,
      status: "online",
      priority: "p1",
      creatorId: product.id,
      boardOrder: 1,
      plannedEndAt: reqEnd1,
      docUrl: "https://feishu.cn/docx/demo-alert-rules",
    },
  });
  const r8 = await prisma.requirement.create({
    data: {
      title: "订单列表导出 Excel",
      summary: "按筛选条件导出订单",
      projectId: app.id,
      status: "online",
      priority: "p2",
      creatorId: fe.id,
      boardOrder: 1,
      actualEndAt: new Date(),
      docUrl: "https://feishu.cn/docx/demo-order-export",
    },
  });

  const assigneePairs = [
    { requirementId: r1.id, userId: product.id, role: "product" },
    { requirementId: r1.id, userId: fe.id, role: "frontend" },
    { requirementId: r1.id, userId: be.id, role: "backend" },
    { requirementId: r2.id, userId: product.id, role: "product" },
    { requirementId: r2.id, userId: fe.id, role: "frontend" },
    { requirementId: r2.id, userId: be.id, role: "backend" },
    { requirementId: r3.id, userId: product.id, role: "product" },
    { requirementId: r3.id, userId: fe.id, role: "frontend" },
    { requirementId: r3.id, userId: be.id, role: "backend" },
    { requirementId: r4.id, userId: product.id, role: "product" },
    { requirementId: r4.id, userId: fe.id, role: "frontend" },
    { requirementId: r4.id, userId: be.id, role: "backend" },
    { requirementId: r5.id, userId: product.id, role: "product" },
    { requirementId: r5.id, userId: fe.id, role: "frontend" },
    { requirementId: r5.id, userId: be.id, role: "backend" },
    { requirementId: r7.id, userId: product.id, role: "product" },
    { requirementId: r7.id, userId: fe.id, role: "frontend" },
    { requirementId: r7.id, userId: be.id, role: "backend" },
    { requirementId: r8.id, userId: product.id, role: "product" },
    { requirementId: r8.id, userId: fe.id, role: "frontend" },
  ];
  await prisma.requirementAssignee.createMany({ data: assigneePairs });

  await prisma.bug.createMany({
    data: [
      {
        title: "看板拖拽后未持久化",
        summary: "刷新后状态回滚",
        docUrl: "https://feishu.cn/docx/demo-bug-dnd",
        projectId: web.id,
        requirementId: r1.id,
        status: "open",
        severity: "critical",
        assigneeId: fe.id,
        creatorId: pm.id,
        boardOrder: 1,
      },
      {
        title: "发版冻结后仍可移出需求",
        summary: "权限校验缺失",
        projectId: web.id,
        requirementId: r2.id,
        status: "in_progress",
        severity: "major",
        assigneeId: be.id,
        creatorId: tech.id,
        boardOrder: 1,
      },
      {
        title: "同义词检索空结果无提示",
        projectId: app.id,
        requirementId: r4.id,
        status: "resolved",
        severity: "minor",
        assigneeId: fe.id,
        creatorId: product.id,
        boardOrder: 1,
        docUrl: "https://feishu.cn/docx/demo-bug-empty",
      },
      {
        title: "报表列表分页错位",
        projectId: dataHub.id,
        status: "closed",
        severity: "major",
        assigneeId: be.id,
        creatorId: pm.id,
        boardOrder: 1,
      },
      {
        title: "登录记住密码本地未加密提示",
        status: "open",
        severity: "trivial",
        assigneeId: fe.id,
        creatorId: admin.id,
        boardOrder: 0,
      },
    ],
  });

  const releaseAt1 = new Date();
  releaseAt1.setDate(releaseAt1.getDate() + 6);
  const releaseAt2 = new Date();
  releaseAt2.setDate(releaseAt2.getDate() + 9);

  const rel1 = await prisma.release.create({
    data: {
      projectId: web.id,
      version: "1.2.0",
      title: "官网一期上线",
      description: "首页 + 产品页",
      status: "frozen",
      plannedAt: releaseAt1,
      createdById: pm.id,
    },
  });
  const rel2 = await prisma.release.create({
    data: {
      projectId: app.id,
      version: "0.9.0",
      title: "App 2.0 Beta",
      description: "拼音搜索与订单导出",
      status: "planning",
      plannedAt: releaseAt2,
      createdById: pm.id,
    },
  });
  const rel3 = await prisma.release.create({
    data: {
      projectId: dataHub.id,
      version: "0.1.0",
      title: "数据中台骨架发布",
      status: "planning",
      plannedAt: plannedFuture,
      createdById: tech.id,
    },
  });

  await prisma.releaseRequirement.createMany({
    data: [
      { releaseId: rel1.id, requirementId: r1.id, sortOrder: 1 },
      { releaseId: rel1.id, requirementId: r2.id, sortOrder: 2 },
      { releaseId: rel1.id, requirementId: r7.id, sortOrder: 3 },
      { releaseId: rel2.id, requirementId: r4.id, sortOrder: 1 },
      { releaseId: rel2.id, requirementId: r8.id, sortOrder: 2 },
      { releaseId: rel3.id, requirementId: r5.id, sortOrder: 1 },
    ],
  });

  await prisma.activityLog.createMany({
    data: [
      {
        entityType: "requirement",
        entityId: r1.id,
        action: "created",
        actorId: product.id,
        message: "创建需求",
      },
      {
        entityType: "release",
        entityId: rel1.id,
        action: "status_changed",
        actorId: pm.id,
        fromValue: JSON.stringify({ status: "planning" }),
        toValue: JSON.stringify({ status: "frozen" }),
        message: "发版冻结",
      },
    ],
  });


  // Role × feature permission defaults (scope=project = global defaults by project role)
  const FEATURES = [
    "users.manage",
    "project.edit",
    "members.manage",
    "requirements.create",
    "requirements.edit",
    "board.move",
    "releases.manage",
    "bugs.edit",
    "leadership.view",
    "docs.edit",
    "products.manage",
  ] as const;
  // 角色（功能权限 + 数据范围）与岗位（项目职责）分开：权限只按角色配置
  for (const r of DEFAULT_ROLES) await prisma.role.upsert({ where: { key: r.key }, create: r, update: {} });
  for (const p of DEFAULT_POSITIONS) await prisma.position.upsert({ where: { key: p.key }, create: p, update: {} });
  const permRows: { scope: string; role: string; feature: string; allowed: boolean }[] = [];
  for (const r of DEFAULT_ROLES) {
    if (r.key === "admin") continue;
    for (const feature of FEATURES) permRows.push({ scope: "role", role: r.key, feature, allowed: defaultRoleAllow(r.key, feature) });
  }
  await prisma.rolePermission.createMany({ data: permRows });

  const docPages = await seedDocs(prisma);
  console.log(`Docs: ${docPages} pages`);
  console.log(`Orgs: ${await seedOrgs(prisma)} created`);
  console.log(`Products: ${await seedProducts(prisma)} created`);
  await seedProductDetails(prisma);

  console.log("Seed OK");
  console.log("Admin: admin@local / Admin123!");
  console.log("Others: pm@local, tech@local, director@local, product@local, fe@local, be@local / Admin123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
