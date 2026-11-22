import { prisma } from "@pm-collab/db/prisma";
import { randomUUID } from "crypto";
import { blockPreview, mdToHtml, splitBlocks } from "../delivery/blocks";
import { casesJson, cleanCase, type TestCase } from "../shared/testcases";
import { REQUIREMENTS, type PersonaKey } from "./data";

/**
 * T51 演示数据补充（T42–T49 的新功能）：
 * - 研发流程：企业启用设计环节、上线关卡「无阻塞 Bug」；商城项目加关卡「进入开发要有 UI 设计稿」；积分项目用 Scrum 迭代；
 * - 迭代：积分项目 3 个迭代（已结束 / 进行中 / 规划中）；
 * - 任务：开发 / 测试阶段的需求按负责人拆出设计、前端、后端、测试、发布任务，状态跟需求阶段一致；
 * - 需求资料：UI 设计稿、可点开的 HTML 原型、需求文档、测试用例、测试报告；
 * - 用例库：需求用例页 + 一份不挂需求的回归用例页。
 * 不造任何代码仓库数据（GitLab 要真实仓库）。
 */

type Ctx = {
  orgId: string;
  who: Record<PersonaKey, string>;
  projectIds: Record<string, string>;
  reqIds: Record<string, string>;
  day: (offset: number) => Date;
  at: (offset: number, hour?: number, minute?: number) => Date;
};

/** 示例 UI 稿地址（不是真实文件，备注里写明） */
const FIGMA = (name: string) => `https://www.figma.com/design/example/${encodeURIComponent(name)}`;

const ORDER = ["req_in_progress", "req_done", "req_design", "dev_todo", "dev_in_progress", "dev_done", "test_todo", "test_in_progress", "test_done", "online"];
const rank = (s: string) => ORDER.indexOf(s);

type TaskStatus = "todo" | "doing" | "done";
/** 任务状态按需求阶段推出来：设计在开发前完成，开发在开发完成时完成，测试在测试完成时完成 */
function taskStatus(kind: string, req: string): TaskStatus {
  const r = rank(req);
  if (kind === "design") return r > rank("req_design") ? "done" : r === rank("req_design") ? "doing" : "todo";
  if (kind === "frontend" || kind === "backend") return r >= rank("dev_done") ? "done" : r === rank("dev_in_progress") ? "doing" : "todo";
  if (kind === "test") return r >= rank("test_done") ? "done" : r === rank("test_in_progress") ? "doing" : "todo";
  return r >= rank("online") ? "done" : "todo";
}

const TASK_TITLE: Record<string, string> = { design: "交互与视觉设计", frontend: "前端开发", backend: "后端接口", test: "测试执行", release: "上线发布" };
const SHARE: Record<string, number> = { design: 2, frontend: 4, backend: 4, test: 3, release: 1 };
const HOURS: Record<string, number> = { design: 8, frontend: 16, backend: 16, test: 8, release: 2 };

async function tasks(c: Ctx) {
  let n = 0;
  for (const r of REQUIREMENTS) {
    if (!r.project || r.status === "cancelled" || rank(r.status) < rank("req_design")) continue;
    if (!r.people.frontend && !r.people.backend) continue;
    const kinds = [
      ...(r.people.product ? ["design"] : []),
      ...(r.people.frontend ? ["frontend"] : []),
      ...(r.people.backend ? ["backend"] : []),
      ...(r.people.qa ? ["test"] : []),
      "release",
    ];
    // 按「设计 → 开发（前后端并行）→ 测试 → 发布」切分需求计划
    const phases: string[][] = [kinds.filter((k) => k === "design"), kinds.filter((k) => k === "frontend" || k === "backend"), kinds.filter((k) => k === "test"), ["release"]].filter((p) => p.length);
    const weights = phases.map((p) => SHARE[p[0]]);
    const total = weights.reduce((a, b) => a + b, 0);
    const span = Math.max(r.end - r.start, phases.length);
    let cursor = r.start;
    let sort = 0;
    for (const [i, p] of phases.entries()) {
      const len = i === phases.length - 1 ? Math.max(r.end - cursor, 0) : Math.max(1, Math.round((span * weights[i]) / total));
      for (const kind of p) {
        const status = taskStatus(kind, r.status);
        const owner = kind === "design" ? r.people.product : kind === "test" ? r.people.qa : kind === "release" ? (r.people.backend ?? r.people.frontend) : r.people[kind as "frontend" | "backend"];
        await prisma.requirementTask.create({
          data: {
            requirementId: c.reqIds[r.ref],
            kind,
            title: `${TASK_TITLE[kind]}：${r.title}`,
            assigneeId: owner ? c.who[owner] : null,
            status,
            startAt: c.day(cursor),
            dueAt: c.day(cursor + len),
            estimate: HOURS[kind],
            sortOrder: sort++,
            doneAt: status === "done" ? c.at(Math.min(cursor + len, -1), 18) : null,
            createdById: c.who[r.people.product ?? "zhou"],
            createdAt: c.at(r.start - 1, 10),
          },
        });
        n++;
      }
      cursor += len;
    }
  }
  return n;
}

/** 积分项目走 Scrum：两周一个迭代 */
async function iterations(c: Ctx) {
  const pid = c.projectIds.points;
  if (!pid) return 0;
  const defs = [
    { name: "迭代 1", goal: "会员等级权益上线", start: -24, end: -11, status: "done", reqs: ["p-level"] },
    { name: "迭代 2", goal: "积分抵扣下单、积分商城兑换", start: -10, end: 3, status: "active", reqs: ["p-deduct", "p-mall", "p-rules"] },
    { name: "迭代 3", goal: "积分过期提醒、流水导出", start: 4, end: 17, status: "planning", reqs: ["p-expire", "p-export"] },
  ];
  for (const d of defs) {
    const it = await prisma.iteration.create({
      data: { projectId: pid, name: d.name, goal: d.goal, startAt: c.day(d.start), endAt: c.day(d.end), status: d.status, capacity: 160, createdById: c.who.wang, createdAt: c.at(d.start - 2, 15), closedAt: d.status === "done" ? c.at(d.end, 18) : null },
      select: { id: true },
    });
    await prisma.requirement.updateMany({ where: { id: { in: d.reqs.map((r) => c.reqIds[r]).filter(Boolean) } }, data: { iterationId: it.id } });
    await prisma.activityLog.create({ data: { entityType: "project", entityId: pid, action: "updated", actorId: c.who.wang, message: `${d.status === "done" ? "完成" : d.status === "active" ? "开始" : "规划"}迭代「${d.name}」`, createdAt: c.at(d.status === "planning" ? -1 : d.status === "done" ? d.end : d.start, 10) } });
  }
  return defs.length;
}

async function flow(c: Ctx) {
  await prisma.flowConfig.create({ data: { scope: "enterprise", scopeId: c.orgId, designStage: true, gates: JSON.stringify(["online:noBlockers"]), updatedById: c.who.zhou } });
  if (c.projectIds.mall) await prisma.flowConfig.create({ data: { scope: "project", scopeId: c.projectIds.mall, gates: JSON.stringify(["dev:ui"]), updatedById: c.who.wang } });
  if (c.projectIds.points) await prisma.flowConfig.create({ data: { scope: "project", scopeId: c.projectIds.points, mode: "scrum", updatedById: c.who.wang } });
}

const PROTOTYPE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>双 11 大促会场原型</title>
<style>body{margin:0;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:#f5f5f7;color:#1d1d1f}.top{background:linear-gradient(135deg,#e5484d,#f76b15);color:#fff;padding:28px 20px;text-align:center}.top h1{margin:0 0 6px;font-size:24px}.cd{display:inline-flex;gap:6px;margin-top:8px}.cd b{background:rgba(0,0,0,.25);border-radius:6px;padding:4px 8px;font-size:20px;min-width:32px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:16px}.card{background:#fff;border-radius:12px;padding:16px;cursor:pointer;transition:transform .15s}.card:hover{transform:translateY(-2px)}.card h3{margin:0 0 4px;font-size:15px}.card p{margin:0;color:#6e6e73;font-size:12px}.share{margin:0 16px 24px;display:block;width:calc(100% - 32px);padding:12px;border:0;border-radius:10px;background:#1d1d1f;color:#fff;font-size:15px;cursor:pointer}.toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#1d1d1f;color:#fff;padding:8px 16px;border-radius:8px;display:none}</style></head>
<body><div class="top"><h1>双 11 狂欢主会场</h1><div>距离开抢还有</div><div class="cd"><b id="d">00</b>天<b id="h">00</b>时<b id="m">00</b>分<b id="s">00</b>秒</div></div>
<div class="grid"><div class="card" data-n="数码分会场"><h3>数码分会场</h3><p>爆款直降 · 12 期免息</p></div><div class="card" data-n="美妆分会场"><h3>美妆分会场</h3><p>大牌满 300 减 50</p></div><div class="card" data-n="家居分会场"><h3>家居分会场</h3><p>买一送一</p></div><div class="card" data-n="生鲜分会场"><h3>生鲜分会场</h3><p>次日达</p></div></div>
<button class="share" id="share">生成分享海报</button><div class="toast" id="t"></div>
<script>var end=Date.now()+5*864e5+3600e3;function p(n){return String(n).padStart(2,"0")}function tick(){var x=Math.max(0,end-Date.now())/1e3;d.textContent=p(Math.floor(x/86400));h.textContent=p(Math.floor(x%86400/3600));m.textContent=p(Math.floor(x%3600/60));s.textContent=p(Math.floor(x%60))}tick();setInterval(tick,1000);
function toast(v){t.textContent=v;t.style.display="block";clearTimeout(window._t);window._t=setTimeout(function(){t.style.display="none"},1600)}document.querySelectorAll(".card").forEach(function(c){c.onclick=function(){toast("进入"+c.dataset.n+"（原型示意）")}});share.onclick=function(){toast("海报已生成，长按保存（原型示意）")};</script></body></html>`;

const COUNTDOWN_CASES: Partial<TestCase>[] = [
  { title: "活动开始前显示倒计时", priority: "P0", precondition: "活动开始时间晚于当前时间", steps: [{ action: "goto", target: "/promo/double11", value: "" }, { action: "expectVisible", target: "倒计时", value: "" }], expected: "会场顶部显示「距离开抢还有 X 天 X 时 X 分 X 秒」，每秒刷新" },
  { title: "倒计时以服务端时间为准", priority: "P0", precondition: "把手机时间调快 1 小时", steps: [{ action: "goto", target: "/promo/double11", value: "" }, { action: "note", target: "对比服务端返回的剩余秒数", value: "" }], expected: "剩余时间与服务端一致，误差不超过 1 秒" },
  { title: "倒计时结束自动切换", priority: "P1", precondition: "活动距离开始 10 秒", steps: [{ action: "goto", target: "/promo/double11", value: "" }, { action: "wait", target: "", value: "12" }, { action: "expectText", target: "", value: "活动进行中" }], expected: "倒计时归零后不刷新页面，自动切换为「活动进行中」" },
  { title: "活动结束后显示已结束", priority: "P1", precondition: "活动已结束", steps: [{ action: "goto", target: "/promo/double11", value: "" }, { action: "expectText", target: "", value: "活动已结束" }], expected: "显示「活动已结束」，分会场入口置灰" },
  { title: "切到后台再回来时间正确", priority: "P2", mode: "manual", precondition: "", steps: [{ action: "note", target: "打开会场后切到后台 5 分钟再回来", value: "" }], expected: "倒计时立即校正，不会停在切走时的时间" },
  { title: "弱网下倒计时不卡顿", priority: "P2", mode: "manual", precondition: "网络限速 3G", steps: [{ action: "note", target: "打开会场观察 1 分钟", value: "" }], expected: "倒计时每秒刷新，不出现跳秒或停顿" },
];

const REGRESSION_CASES: Partial<TestCase>[] = [
  { title: "登录后进入首页", priority: "P0", steps: [{ action: "goto", target: "/login", value: "" }, { action: "fill", target: "手机号", value: "13800000000" }, { action: "click", target: "登录", value: "" }, { action: "expectUrl", target: "", value: "/home" }], expected: "登录成功跳转首页，显示昵称" },
  { title: "搜索商品并加入购物车", priority: "P0", steps: [{ action: "goto", target: "/home", value: "" }, { action: "fill", target: "搜索框", value: "运动鞋" }, { action: "press", target: "搜索框", value: "Enter" }, { action: "click", target: "第一个商品", value: "" }, { action: "click", target: "加入购物车", value: "" }, { action: "expectText", target: "", value: "已加入购物车" }], expected: "购物车角标数量 +1" },
  { title: "购物车结算下单", priority: "P0", steps: [{ action: "goto", target: "/cart", value: "" }, { action: "click", target: "去结算", value: "" }, { action: "click", target: "提交订单", value: "" }, { action: "expectText", target: "", value: "待支付" }], expected: "生成待支付订单，金额与购物车一致" },
  { title: "优惠券叠加金额正确", priority: "P0", precondition: "账号有店铺券和平台券各一张", steps: [{ action: "goto", target: "/checkout", value: "" }, { action: "note", target: "核对优惠明细", value: "" }], expected: "先店铺券、再满减、最后平台券，明细合计等于优惠总额" },
  { title: "订单列表首屏加载", priority: "P1", steps: [{ action: "goto", target: "/orders", value: "" }, { action: "expectVisible", target: "订单卡片", value: "" }], expected: "首屏 1 秒内出现订单，滚动到底自动加载下一页" },
  { title: "申请退货上传凭证", priority: "P1", mode: "manual", steps: [{ action: "note", target: "已签收订单 › 申请退货 › 上传 3 张图片", value: "" }], expected: "提交成功，退货单显示凭证缩略图" },
  { title: "商品详情页视频播放", priority: "P2", mode: "manual", steps: [{ action: "note", target: "Wi-Fi 下打开带视频的商品", value: "" }], expected: "首图位置自动静音播放，点击可开声音" },
];

async function casesPage(c: Ctx, projectKey: string, title: string, raw: Partial<TestCase>[], author: PersonaKey, offset: number, reqRef?: string) {
  const projectId = c.projectIds[projectKey];
  const cases = raw.map((x, i) => cleanCase({ ...x, feature: "", mode: x.mode ?? "auto" }, i)).filter((x): x is TestCase => !!x);
  const json = casesJson(cases);
  const when = c.at(offset, 15);
  const max = await prisma.docPage.aggregate({ where: { projectId, parentId: null }, _max: { sortOrder: true } });
  const page = await prisma.docPage.create({
    data: { projectId, title, kind: "testcases", body: json, version: 1, publishedAt: when, createdAt: when, sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: c.who[author], updatedById: c.who[author], versions: { create: { version: 1, title, body: json, authorId: c.who[author], createdAt: when } } },
    select: { id: true },
  });
  await prisma.activityLog.create({ data: { entityType: "doc", entityId: page.id, action: "created", actorId: c.who[author], message: `新建用例页：${title}`, createdAt: when } });
  if (reqRef) await prisma.docPageLink.create({ data: { pageId: page.id, requirementId: c.reqIds[reqRef], source: "manual" } });
  return page.id;
}

async function reportPage(c: Ctx, projectKey: string, title: string, md: string, offset: number, reqRef: string) {
  const projectId = c.projectIds[projectKey];
  const html = mdToHtml(md);
  const when = c.at(offset, 17);
  const page = await prisma.docPage.create({
    data: { projectId, title, body: html, version: 1, publishedAt: when, createdAt: when, sortOrder: 90, statusTag: "approved", creatorId: c.who.feng, updatedById: c.who.feng, versions: { create: { version: 1, title, body: html, authorId: c.who.feng, createdAt: when } } },
    select: { id: true },
  });
  await prisma.docPageLink.create({ data: { pageId: page.id, requirementId: c.reqIds[reqRef], source: "manual" } });
  return page.id;
}

async function artifacts(c: Ctx) {
  let n = 0;
  const add = async (ref: string, data: { kind: string; source: string; title: string; url?: string; docPageId?: string; note?: string; share?: boolean; by: PersonaKey; offset: number }) => {
    const id = c.reqIds[ref];
    if (!id) return null;
    const row = await prisma.requirementArtifact.create({
      data: { requirementId: id, kind: data.kind, source: data.source, title: data.title, url: data.url ?? null, docPageId: data.docPageId ?? null, note: data.note ?? null, shareToChildren: data.share ?? true, sortOrder: n, createdById: c.who[data.by], createdAt: c.at(data.offset, 11) },
      select: { id: true },
    });
    n++;
    return row.id;
  };

  // 大促会场：UI 稿 + 可点开的 HTML 原型，子需求（倒计时、分享海报）自动继承
  await add("m-promo", { kind: "ui", source: "link", title: "大促会场 UI 设计稿", url: FIGMA("双11大促会场"), note: "v2 终稿（示例地址）", by: "chen", offset: -8 });
  const protoId = await add("m-promo", { kind: "prototype", source: "file", title: "大促会场可交互原型", note: "可点开体验倒计时和分会场入口", by: "chen", offset: -7 });
  if (protoId) {
    const data = Buffer.from(PROTOTYPE, "utf8");
    const att = await prisma.attachment.create({ data: { ownerType: "artifact", ownerId: protoId, name: "大促会场原型.html", mime: "text/html", size: data.length, data, uploaderId: c.who.chen }, select: { id: true } });
    await prisma.requirementArtifact.update({ where: { id: protoId }, data: { attachmentId: att.id } });
  }
  // 倒计时：用例页（项目「测试」标签的用例库里也能看到）
  const cd = await casesPage(c, "mall", "大促倒计时组件 · 测试用例", COUNTDOWN_CASES, "feng", -3, "m-countdown");
  await add("m-countdown", { kind: "testcases", source: "doc", title: "大促倒计时组件 · 测试用例", docPageId: cd, by: "feng", offset: -3 });
  // 不挂需求的回归用例库
  await casesPage(c, "mall", "商城核心链路 · 回归用例", REGRESSION_CASES, "feng", -12);
  // 已上线的需求：测试报告
  const rp = await reportPage(
    c,
    "mall",
    "规格选择改为图片规格 · 测试报告",
    "## 结论\n\n**通过，可以上线。** 共执行 18 条用例，通过 18 条；回归 1 轮。\n\n## 覆盖范围\n\n- 颜色规格缩略图展示、选中切换主图\n- 无图规格回退为文字\n- 库存为 0 的规格置灰\n\n## 遗留问题\n\n- 低端安卓机缩略图首次加载约 300ms，已记录为优化项，不影响上线。",
    -15,
    "m-spec",
  );
  await add("m-spec", { kind: "report", source: "doc", title: "规格选择改为图片规格 · 测试报告", docPageId: rp, by: "feng", offset: -15 });
  await add("m-spec", { kind: "ui", source: "link", title: "图片规格 UI 设计稿", url: FIGMA("图片规格"), note: "示例地址", by: "chen", offset: -32 });
  // 其他进行中的需求：UI 稿 / 需求文档
  await add("m-floor", { kind: "ui", source: "link", title: "楼层配置后台 UI 设计稿", url: FIGMA("楼层组件可视化配置"), note: "示例地址", by: "chen", offset: -9 });
  await add("m-video", { kind: "ui", source: "link", title: "详情页视频 UI 设计稿", url: FIGMA("详情页短视频"), note: "示例地址", by: "chen", offset: -17 });
  await add("m-poster", { kind: "ui", source: "link", title: "分享海报样式", url: FIGMA("分享海报"), note: "示例地址", share: false, by: "chen", offset: 0 });
  await add("p-deduct", { kind: "ui", source: "link", title: "积分抵扣 结算页设计稿", url: FIGMA("积分抵扣"), note: "示例地址", by: "chen", offset: -8 });
  await add("s-offline", { kind: "ui", source: "link", title: "离线盘点 PDA 界面", url: FIGMA("离线盘点"), note: "示例地址", by: "lin", offset: -7 });
  // 主需求文档也作为「需求文档」资料展示
  for (const ref of ["m-coupon", "s-offline", "p-deduct"]) {
    const r = await prisma.requirement.findUnique({ where: { id: c.reqIds[ref] }, select: { docPageId: true, title: true } });
    if (r?.docPageId) await add(ref, { kind: "doc", source: "doc", title: `${r.title} · 需求文档`, docPageId: r.docPageId, by: "chen", offset: -6 });
  }
  return n;
}

const INVOICE_PRD = `> **一句话**\n> 下单时填抬头，签收后自动开电子发票并发到邮箱，减少客服人工开票。

## 1. 背景与目标

现在发票全部由客服在后台手工开具，大促期间排队 3 天以上。目标：自动开票覆盖 90% 订单，开票成功率 ≥ 99%。

## 2. 范围

支持增值税电子普通发票和专用发票，PC 和 App 下单都可以填写。

## 3. 功能清单

- F-01 下单时填写发票抬头（个人 / 企业）
- F-02 签收后自动开票并发送到邮箱
- F-03 开票失败自动重试，3 次失败通知客服

## 4. 规则

| 项 | 规则 |
| --- | --- |
| 开票金额 | 按订单实付金额，含运费，扣除优惠 |
| 抬头 | 2–50 字；企业抬头必须填税号（15–20 位） |
| 邮箱 | 默认带出账号绑定的邮箱，可修改 |

## 待确认问题

- 发票类型：只开普票，还是也要支持专票？
- 是否需要发票查询、重发和退款后冲红？`;

/** 需求交付演示：「电子发票开具」的需求纪要下有一份 PRD 草稿，小围按回答提了 3 处修改，在 PRD 页上直接对照接受 / 拒绝 */
async function prdDelivery(c: Ctx) {
  const reqId = c.reqIds["m-invoice"];
  const projectId = c.projectIds.mall;
  if (!reqId || !projectId) return;
  const srcMd = "## 会议纪要（11 月 19 日）\n\n- 客服反馈：大促期间手工开票排队 3 天以上\n- 希望下单时填抬头，签收后自动开电子发票发到邮箱\n- 开票失败要能重试，不能丢\n- 待定：专票要不要做、要不要能查询和重发";
  const srcHtml = mdToHtml(srcMd);
  const t0 = c.at(-3, 11);
  const src = await prisma.docPage.create({
    data: { projectId, title: "电子发票开具 · 需求纪要", body: srcHtml, version: 1, publishedAt: t0, createdAt: t0, sortOrder: 80, creatorId: c.who.xu, updatedById: c.who.xu, versions: { create: { version: 1, title: "电子发票开具 · 需求纪要", body: srcHtml, authorId: c.who.xu, createdAt: t0 } } },
    select: { id: true, projectId: true },
  });
  await prisma.requirement.update({ where: { id: reqId }, data: { docPageId: src.id } });
  await prisma.docPageLink.create({ data: { pageId: src.id, requirementId: reqId, source: "manual" } });
  const title = "PRD · 电子发票开具";
  const body = mdToHtml(INVOICE_PRD);
  const when = c.at(-1, 15);
  const prd = await prisma.docPage.create({
    data: { projectId: src.projectId, parentId: src.id, title, body, version: 1, publishedAt: when, createdAt: when, statusTag: "draft", creatorId: c.who.chen, updatedById: c.who.chen, versions: { create: { version: 1, title, body, authorId: c.who.chen, createdAt: when } } },
    select: { id: true },
  });
  const d = await prisma.delivery.create({ data: { projectId: src.projectId, sourcePageId: src.id, prdPageId: prd.id, prdStatus: "draft", prdSkillId: "builtin:prd", createdById: c.who.chen, createdAt: when } });
  const b = splitBlocks(body);
  const find = (re: RegExp) => b.findIndex((x) => re.test(x));
  const mk = (title: string, op: "replace" | "insert_after", i: number, md: string) => {
    const html = mdToHtml(md);
    return { id: randomUUID(), title, op, status: "pending", before: op === "insert_after" ? `在「${blockPreview(b[i], 40)}」后插入` : blockPreview(b[i]), after: blockPreview(html), targetHtml: b[i], html };
  };
  const scope = find(/支持增值税电子普通发票/);
  const list = find(/F-03/);
  const qs = b.length - 1;
  if (scope < 0 || list < 0) return;
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage: "prd", role: "assistant", content: "PRD 已生成：3 个功能点，有 2 个问题需要你确认（见文档末尾「待确认问题」）。直接在下面回答就行，我会给出对应的修改。", createdAt: when } });
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage: "prd", role: "user", content: "1. 只开增值税电子普通发票\n2. 需要查询、重发和冲红", userId: c.who.chen, createdAt: c.at(-1, 16) } });
  await prisma.deliveryMessage.create({
    data: {
      deliveryId: d.id,
      stage: "prd",
      role: "assistant",
      content: "按你的回答改 3 处：范围只保留普票，功能清单加上查询 / 重发 / 冲红，已回答的问题从待确认里去掉。",
      suggestions: [
        mk("2. 范围 · 发票类型", "replace", scope, "只开具增值税电子普通发票，PC 和 App 下单都可以填写；专用发票不在本期范围。"),
        mk("3. 功能清单 · 新增查询与重发", "replace", list, "- F-01 下单时填写发票抬头（个人 / 企业）\n- F-02 签收后自动开票并发送到邮箱\n- F-03 开票失败自动重试，3 次失败通知客服\n- F-04 订单详情里查询发票、重发到邮箱；退款后自动冲红"),
        mk("待确认问题 · 已全部回答", "replace", qs, "无"),
      ] as never,
      createdAt: c.at(-1, 16, 5),
    },
  });
}

export async function seedAgile(c: Ctx) {
  await flow(c);
  const iters = await iterations(c);
  const taskCount = await tasks(c);
  const artifactCount = await artifacts(c);
  await prdDelivery(c);
  return { iterations: iters, tasks: taskCount, artifacts: artifactCount };
}

/** 清空：迭代、研发流程配置（任务、资料随需求级联删除，原型附件按上传人删除） */
export async function wipeAgile(orgId: string, projectIds: string[]) {
  await prisma.iteration.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.flowConfig.deleteMany({ where: { OR: [{ scope: "enterprise", scopeId: orgId }, { scope: "project", scopeId: { in: projectIds } }] } });
}
