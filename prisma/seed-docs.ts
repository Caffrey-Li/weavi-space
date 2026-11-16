/**
 * 文档演示数据：给还没有任何页面的项目空间建一棵示例页面树。
 * 只往空空间里加数据，不删除、不覆盖已有内容，可以重复执行。
 *
 *   npx tsx prisma/seed-docs.ts            # 用 .env 的 DATABASE_URL
 *   DATABASE_URL="postgresql://localhost:5432/pm_collab_demo" npx tsx prisma/seed-docs.ts
 *
 * seed.ts 末尾也会调用 seedDocs()。
 */
import { PrismaClient } from "@prisma/client";

type Req = { id: string; title: string; status: string };

function ref(r: Req | undefined) {
  if (!r) return "";
  return `<a class="doc-ref" data-ref-kind="req" data-ref-id="${r.id}" href="/requirements/${r.id}" contenteditable="false"><span class="doc-ref-title">${escape(r.title)}</span></a>`;
}

function escape(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function prdBody(projectName: string, req?: Req, owner = "产品负责人") {
  return [
    `<div class="doc-panel" data-tone="info"><p><strong>本页已通过需求评审</strong></p><p>开发与测试以本页为准；变更请在页面里修改并重新发布，同步更新关联需求 ${ref(req)}。</p></div>`,
    `<h2>背景</h2>`,
    `<p>${escape(projectName)} 目前登录只支持账号密码，新同事首次使用需要找管理员要初始密码，平均要 1 天才能开始使用。公司已统一使用企业微信，扫码登录可以把首次登录缩短到 1 分钟以内。</p>`,
    `<h2>目标</h2>`,
    `<ul><li>支持企业微信扫码登录，已有账号按手机号自动绑定</li><li>保留账号密码登录，作为企业微信不可用时的备用方式</li><li>登录成功率 ≥ 99%，首次登录耗时 &lt; 60 秒</li></ul>`,
    `<h2>验收标准</h2>`,
    `<table class="doc-table"><thead><tr><th>场景</th><th>预期结果</th><th>负责人</th></tr></thead><tbody>` +
      `<tr><td>已绑定账号扫码</td><td>直接进入工作台</td><td>${escape(owner)}</td></tr>` +
      `<tr><td>未绑定账号扫码</td><td>提示联系管理员开通，不自动建号</td><td>${escape(owner)}</td></tr>` +
      `<tr><td>Safari 浏览器扫码</td><td>回调正常，无需刷新页面</td><td>${escape(owner)}</td></tr></tbody></table>`,
    `<h2>待确认</h2>`,
    `<ul class="doc-todo"><li data-checked="true">确认企业微信应用的回调域名</li><li>和安全组确认扫码登录的会话时长</li></ul>`,
  ].join("");
}

function techBody(req?: Req) {
  return [
    `<p>本文说明 ${ref(req)} 的技术方案，评审后进入开发。</p>`,
    `<h2>方案概述</h2>`,
    `<ol><li>前端在登录页增加扫码入口，嵌入企业微信二维码组件</li><li>后端新增回调接口，用 code 换取成员身份并匹配手机号</li><li>匹配成功后签发与账号密码登录相同的会话 Cookie</li></ol>`,
    `<div class="doc-panel" data-tone="note"><p>回调接口必须校验 state，防止 CSRF；state 只能使用一次。</p></div>`,
    `<h2>接口</h2>`,
    `<pre>GET /api/auth/wecom/callback?code=…&amp;state=…\n→ 302 /（成功） | 302 /login?error=unbound（未绑定）</pre>`,
    `<h2>风险</h2>`,
    `<div class="doc-panel" data-tone="warning"><p>企业微信接口有频率限制，高峰期需要缓存 access_token，不能每次登录都去换。</p></div>`,
  ].join("");
}

function testBody() {
  return [
    `<p><span class="doc-status" data-tone="warning" contenteditable="false">评审中</span> 冒烟用例，发版前由测试负责人执行。</p>`,
    `<table class="doc-table"><thead><tr><th>编号</th><th>步骤</th><th>预期</th></tr></thead><tbody>` +
      `<tr><td>TC-01</td><td>打开登录页，切换到扫码登录</td><td>显示二维码，30 秒自动刷新</td></tr>` +
      `<tr><td>TC-02</td><td>用已绑定账号扫码</td><td>2 秒内进入工作台</td></tr>` +
      `<tr><td>TC-03</td><td>用未绑定账号扫码</td><td>提示联系管理员</td></tr></tbody></table>`,
  ].join("");
}

function meetingBody(names: string[]) {
  return [
    `<p><strong>参会：</strong>${escape(names.join("、") || "项目成员")}</p>`,
    `<h2>结论</h2>`,
    `<ul><li>本周五冻结 v2.4.0 范围，之后的需求进入下个版本</li><li>扫码登录先在内部灰度一周</li></ul>`,
    `<h2>行动项</h2>`,
    `<ul class="doc-todo"><li data-checked="true">整理灰度名单</li><li>补充导出接口的压测数据</li><li>更新发版说明</li></ul>`,
  ].join("");
}

export async function seedDocs(prisma: PrismaClient) {
  const projects = await prisma.project.findMany({
    where: { status: { not: "archived" } },
    include: {
      members: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      requirements: { select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" }, take: 3 },
      _count: { select: { docPages: true } },
    },
  });
  let created = 0;
  for (const p of projects) {
    if (p._count.docPages > 0) continue;
    const users = p.members.map((m) => m.user);
    const fallback = await prisma.user.findFirst({ where: { globalRole: "admin" }, select: { id: true, name: true } });
    const author = users[0] || fallback;
    if (!author) continue;
    const editor = users[1] || author;
    const [req1, req2] = p.requirements;
    const now = Date.now();
    const day = 86_400_000;

    const page = async (opts: {
      title: string;
      body: string;
      parentId?: string | null;
      sortOrder: number;
      statusTag?: string | null;
      daysAgo: number;
      by?: { id: string };
      links?: Req[];
      draftOnly?: boolean;
    }) => {
      const at = new Date(now - opts.daysAgo * day);
      const by = opts.by || author!;
      const pg = await prisma.docPage.create({
        data: {
          projectId: p.id,
          parentId: opts.parentId ?? null,
          title: opts.title,
          body: opts.draftOnly ? "" : opts.body,
          draftTitle: opts.draftOnly ? opts.title : null,
          draftBody: opts.draftOnly ? opts.body : null,
          draftUpdatedAt: opts.draftOnly ? at : null,
          statusTag: opts.statusTag ?? null,
          sortOrder: opts.sortOrder,
          version: opts.draftOnly ? 0 : 1,
          viewCount: opts.draftOnly ? 0 : 3 + Math.floor(Math.random() * 20),
          creatorId: author!.id,
          updatedById: by.id,
          publishedAt: opts.draftOnly ? null : at,
          createdAt: at,
          updatedAt: at,
        },
      });
      if (!opts.draftOnly) {
        await prisma.docPageVersion.create({
          data: { pageId: pg.id, version: 1, title: opts.title, body: opts.body, authorId: by.id, createdAt: at },
        });
      }
      for (const r of opts.links || []) {
        await prisma.docPageLink.create({ data: { pageId: pg.id, requirementId: r.id, source: "body" } });
      }
      created += 1;
      return pg;
    };

    const prd = await page({ title: "产品需求", body: "<p>这里放本项目的产品需求文档，每个版本一页。</p>", sortOrder: 0, daysAgo: 20 });
    await page({
      title: req1 ? `v2.4.0 ${req1.title}` : "v2.4.0 企业微信扫码登录",
      body: prdBody(p.name, req1, editor.name),
      parentId: prd.id,
      sortOrder: 0,
      statusTag: "approved",
      daysAgo: 1,
      by: editor,
      links: req1 ? [req1] : [],
    });
    await page({
      title: "v2.5.0 进展总览改版",
      body: `<p>进展总览目前只能看单周数据，技术负责人和项目经理需要手动对比多周趋势。本次改版增加按周汇总和趋势图。</p><h2>改版目标</h2><ul><li>按周汇总上线需求数、在途需求和未关闭 Bug</li><li>项目进展表增加「趋势」列</li></ul>`,
      parentId: prd.id,
      sortOrder: 1,
      statusTag: "draft",
      daysAgo: 0,
      draftOnly: true,
    });
    const tech = await page({ title: "技术方案", body: "<p>技术方案与接口设计。</p>", sortOrder: 1, daysAgo: 18 });
    await page({
      title: "登录鉴权方案",
      body: techBody(req1),
      parentId: tech.id,
      sortOrder: 0,
      statusTag: "review",
      daysAgo: 2,
      links: req1 ? [req1] : [],
    });
    const qa = await page({ title: "测试与发布", body: "<p>测试用例与发版检查清单。</p>", sortOrder: 2, daysAgo: 15 });
    await page({ title: "v2.4.0 冒烟测试用例", body: testBody(), parentId: qa.id, sortOrder: 0, daysAgo: 3 });
    const mt = await page({ title: "会议纪要", body: "<p>周会与评审会纪要。</p>", sortOrder: 3, daysAgo: 14 });
    await page({
      title: "周会纪要 10月30日",
      body: meetingBody(users.slice(0, 4).map((u) => u.name)) + (req2 ? `<p>跟进：${ref(req2)}</p>` : ""),
      parentId: mt.id,
      sortOrder: 0,
      daysAgo: 1,
      links: req2 ? [req2] : [],
    });
  }
  return created;
}

// 直接运行时
if (require.main === module) {
  const prisma = new PrismaClient();
  seedDocs(prisma)
    .then((n) => console.log(`文档演示数据：新建 ${n} 个页面`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
