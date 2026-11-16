/**
 * 产品示例：一个产品（Weavi Space 协同平台）及其功能结构（菜单 › 功能模块 › 功能点），
 * 关联到第一个项目，并把该项目的部分需求挂到功能模块上。
 * 只在还没有产品时补充，不删数据；seed.ts 末尾会调用。
 *
 * 单独使用：DATABASE_URL=postgresql://localhost:5432/pm_collab_demo npx tsx prisma/seed-products.ts
 */
import { PrismaClient } from "@prisma/client";

type Spec = { name: string; type: "menu" | "module" | "feature"; code?: string; children?: Spec[] };

const STRUCTURE: Spec[] = [
  {
    name: "工作",
    type: "menu",
    code: "WORK",
    children: [
      { name: "工作台", type: "module", code: "WORK.HOME" },
      {
        name: "需求池",
        type: "module",
        code: "PROJ.REQ",
        children: [
          { name: "新建需求", type: "feature", code: "REQ.CREATE" },
          { name: "需求详情", type: "feature", code: "REQ.DETAIL" },
          { name: "子需求", type: "feature", code: "REQ.SUB" },
        ],
      },
      { name: "看板", type: "module", code: "PROJ.BOARD" },
      { name: "发版", type: "module", code: "WORK.RELEASE" },
      { name: "Bug", type: "module", code: "WORK.BUG" },
    ],
  },
  { name: "产品", type: "menu", code: "PRODUCT", children: [{ name: "功能结构", type: "module", code: "PRODUCT.TREE" }] },
  { name: "文档", type: "menu", code: "DOCS", children: [{ name: "页面编辑", type: "module", code: "DOCS.EDIT" }] },
  { name: "设置", type: "menu", code: "SETTINGS", children: [{ name: "账号", type: "module", code: "SETTINGS.ACCOUNT" }] },
];

const ENVIRONMENTS = [
  { name: "生产", urls: [{ label: "前台", url: "https://collab.example.com", network: "external", note: "用户入口" }, { label: "管理后台", url: "https://collab.example.com/admin", network: "internal", note: "需连 VPN" }] },
  { name: "预发", urls: [{ label: "前台", url: "https://staging.collab.example.com", network: "external", note: "" }] },
  { name: "测试", urls: [{ label: "前台", url: "https://test.collab.example.com", network: "internal", note: "测试账号见文档" }] },
  { name: "开发", urls: [{ label: "前台", url: "http://10.12.3.45:3100", network: "internal", note: "开发联调" }] },
];
const INTRO = `<h2>产品定位</h2><p>Weavi Space 是面向研发团队的项目管理协同平台，把需求、看板、发版、Bug 和文档放在一处，让产品、研发和测试看到同一份进度。</p><h2>目标用户</h2><ul><li>产品经理：维护需求池和功能结构</li><li>研发与测试：按看板推进需求、处理 Bug</li><li>管理者：查看进展总览</li></ul>`;

/** 示例架构图：几个方块连成一条线，够看出缩略图和缩放效果 */
function diagram(title: string, boxes: string[]) {
  const items = boxes
    .map((b, i) => `<rect x="${40 + i * 200}" y="120" width="160" height="72" rx="8" fill="#EEF4FF" stroke="#3F72F6"/><text x="${120 + i * 200}" y="161" text-anchor="middle" font-size="16" fill="#2449B8">${b}</text>${i ? `<path d="M${i * 200} 156h40" stroke="#3F72F6" stroke-width="2"/>` : ""}`)
    .join("");
  const width = 80 + boxes.length * 200 - 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="240" viewBox="0 0 ${width} 240"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="64" font-size="20" font-weight="600" fill="#1c1c1f">${title}</text>${items}</svg>`;
}
const ARCHITECTURES = [
  { type: "product", name: "产品全景图", description: "从需求到发版的产品主线。", boxes: ["需求池", "看板", "发版", "Bug"] },
  { type: "system", name: "系统部署架构", description: "Next.js 应用读写 PostgreSQL，飞书同步由定时任务写入。", boxes: ["浏览器", "Next.js", "Prisma", "数据库"] },
  { type: "database", name: "核心表结构", description: "产品、项目、需求之间的主要关系。", boxes: ["products", "projects", "requirements"] },
];

/** 给第一个未归档的产品补介绍、环境和架构图：已有内容的部分跳过，不覆盖 */
export async function seedProductDetails(prisma: PrismaClient) {
  const product = await prisma.product.findFirst({ where: { status: { not: "archived" } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const user = await prisma.user.findFirst({ where: product?.ownerId ? { id: product.ownerId } : {}, orderBy: { createdAt: "asc" } });
  if (!product || !user) return;
  if (!(await prisma.productIntro.count({ where: { productId: product.id } }))) {
    await prisma.productIntro.create({ data: { productId: product.id, html: INTRO, updatedById: user.id } });
  }
  if (!product.environments) {
    await prisma.product.update({ where: { id: product.id }, data: { environments: JSON.stringify(ENVIRONMENTS) } });
  }
  if (await prisma.productArchitecture.count({ where: { productId: product.id } })) return;
  for (const a of ARCHITECTURES) {
    const arch = await prisma.productArchitecture.create({
      data: { productId: product.id, type: a.type, name: a.name, description: a.description, createdById: user.id, updatedById: user.id },
    });
    const data = Buffer.from(diagram(a.name, a.boxes));
    const image = await prisma.attachment.create({
      data: { ownerType: "product_arch", ownerId: arch.id, name: `${a.name}.svg`, mime: "image/svg+xml", size: data.length, data, uploaderId: user.id },
    });
    await prisma.productArchitecture.update({ where: { id: arch.id }, data: { imageId: image.id } });
  }
}

export async function seedProducts(prisma: PrismaClient) {
  if (await prisma.product.count()) return 0;
  const owner = await prisma.user.findFirst({ where: { globalRole: "product" } });
  const product = await prisma.product.create({
    data: {
      name: "Weavi Space 协同平台",
      code: "NOVA",
      description: "产品研发协同主平台：需求、看板、发版、Bug、文档",
      status: "maintaining",
      ownerId: owner?.id ?? null,
    },
  });
  const modules: string[] = [];
  const create = async (specs: Spec[], parentId: string | null) => {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const node = await prisma.productNode.create({
        data: { productId: product.id, parentId, type: s.type, name: s.name, code: s.code ?? null, ownerId: owner?.id ?? null, sortOrder: i },
      });
      if (s.type !== "menu") modules.push(node.id);
      if (s.children) await create(s.children, node.id);
    }
  };
  await create(STRUCTURE, null);

  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (project) {
    await prisma.project.update({ where: { id: project.id }, data: { productId: product.id } });
    const reqs = await prisma.requirement.findMany({ where: { projectId: project.id }, select: { id: true }, take: 12 });
    for (let i = 0; i < reqs.length; i++) {
      await prisma.requirement.update({ where: { id: reqs[i].id }, data: { productId: product.id, productNodeId: modules[i % modules.length] } });
    }
  }
  return 1;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedProducts(prisma)
    .then(async (n) => {
      await seedProductDetails(prisma);
      console.log(`Products: ${n} created`);
    })
    .finally(() => prisma.$disconnect());
}
