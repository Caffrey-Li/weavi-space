import { readFileSync } from "node:fs";
import pg from "pg";
import { randomBytes } from "node:crypto";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || decodeURIComponent(url.username) !== "pm_test" || !/^\/pm_collab_t9_e2e_test_[a-f0-9]+$/.test(url.pathname)) throw new Error("仅允许本任务新建的隔离安全测试库");
const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const base = "http://127.0.0.1:3119";
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
let passed = 0;
async function call(path, { token = fx.v1.full, method = "GET", body } = {}) {
  return fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function check(name, value) { if (!value) throw new Error(name); passed++; }
async function count(table) { return Number((await db.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n); }
async function snapshot() {
  const req = await db.query('SELECT id, title, status, revision FROM requirements WHERE id = ANY($1) ORDER BY id', [[fx.b.reqA, fx.b.reqB]]);
  const bug = await db.query('SELECT id, title, status, revision FROM bugs WHERE id = $1', [fx.b.bugB]);
  return JSON.stringify({ req: req.rows, bug: bug.rows });
}
try {
  const beforeReq = await count("requirements"), beforeBug = await count("bugs"), beforeComment = await count("requirement_comments"), beforeRows = await snapshot();
  let r = await call("/me"); check("令牌身份", r.status === 200 && (await r.json()).data.id === fx.v1.managerId);
  r = await call(`/requirements/${fx.b.reqA}`); const row = (await r.json()).data; check("同企业需求", r.status === 200 && row.id === fx.b.reqA);
  check("跨企业需求 404", (await call(`/requirements/${fx.b.reqB}`)).status === 404);
  check("跨企业 Bug 404", (await call(`/bugs/${fx.b.bugB}`)).status === 404);
  check("跨企业项目 404", (await call(`/projects/${fx.b.projB}`)).status === 404);
  check("scope 不足 403", (await call("/bugs", { token: fx.v1.limited })).status === 403);
  const insufficient = [
    ["/projects"], [`/projects/${fx.b.projA}`], ["/bugs"], [`/bugs/${fx.b.bugA1}`],
    ["/releases"], [`/releases/${fx.v1.releaseId}`], ["/products"], [`/products/${fx.v1.productId}`],
    ["/docs/spaces"], [`/docs/pages/${fx.v1.docId}`],
    ["/requirements", "POST", { title: "scope" }], [`/requirements/${fx.b.reqA}`, "PATCH", { title: "scope" }],
    [`/requirements/${fx.b.reqA}/status`, "PATCH", { status: "req_in_progress" }], [`/requirements/${fx.b.reqA}/comments`, "POST", { body: "<p>x</p>" }],
    ["/bugs", "POST", { title: "scope", projectId: fx.b.projA }], [`/bugs/${fx.b.bugA1}`, "PATCH", { title: "scope" }],
    [`/bugs/${fx.b.bugA1}/status`, "PATCH", { status: "open" }], [`/bugs/${fx.b.bugA1}/comments`, "POST", { body: "<p>x</p>" }],
  ];
  for (const [path, method = "GET", body] of insufficient) check("未授予 scope 返回 403", (await call(path, { token: fx.v1.limited, method, body })).status === 403);
  const foreignWrites = [
    [`/requirements/${fx.b.reqB}`, "PATCH", { title: "foreign" }],
    [`/requirements/${fx.b.reqB}/status`, "PATCH", { status: "req_in_progress" }],
    [`/requirements/${fx.b.reqB}/comments`, "POST", { body: "<p>x</p>" }],
    ["/bugs", "POST", { title: "foreign", projectId: fx.b.projB }],
    [`/bugs/${fx.b.bugB}`, "PATCH", { title: "foreign" }],
    [`/bugs/${fx.b.bugB}/status`, "PATCH", { status: "open" }],
    [`/bugs/${fx.b.bugB}/comments`, "POST", { body: "<p>x</p>" }],
  ];
  for (const [path, method, body] of foreignWrites) check("跨企业写入返回 404", (await call(path, { method, body })).status === 404);
  const prior = await db.query('SELECT allowed FROM role_permissions WHERE scope = $1 AND role = $2 AND feature = $3', ['role', 'manager', 'requirements.edit']);
  await db.query('INSERT INTO role_permissions (id, scope, role, feature, allowed) VALUES ($1, $2, $3, $4, false) ON CONFLICT (scope, role, feature) DO UPDATE SET allowed = false', ['v1-deny-test', 'role', 'manager', 'requirements.edit']);
  check("角色权限收回后返回 403", (await call(`/requirements/${fx.b.reqA}`, { method: "PATCH", body: { title: "denied" } })).status === 403);
  if (prior.rowCount) await db.query('UPDATE role_permissions SET allowed = $1 WHERE scope = $2 AND role = $3 AND feature = $4', [prior.rows[0].allowed, 'role', 'manager', 'requirements.edit']);
  else await db.query('DELETE FROM role_permissions WHERE id = $1', ['v1-deny-test']);
  check("跨企业写入 404", (await call("/requirements", { method: "POST", body: { title: "cross", projectId: fx.b.projB } })).status === 404);
  check("无效链接先于不可见父需求", (await call("/requirements", { method: "POST", body: { title: "order", docUrl: "javascript:bad", parentId: fx.b.reqB } })).status === 400);
  check("不可见附件不能加入评论", (await call(`/requirements/${fx.b.reqA}/comments`, { method: "POST", body: { body: `<p>x</p><img src="/api/attachments/${fx.b.attB}">` } })).status === 404);
  check("scope 不足不能写入", (await call("/requirements", { token: fx.v1.limited, method: "POST", body: { title: "denied", projectId: fx.b.projA } })).status === 403);
  check("跨企业修改 404", (await call(`/requirements/${fx.b.reqB}`, { method: "PATCH", body: { title: "denied" } })).status === 404);
  check("无效状态先于不可见资源", (await call(`/requirements/${fx.b.reqB}/status`, { method: "PATCH", body: { status: "not_a_status" } })).status === 400);
  check("版本冲突 409", (await call(`/requirements/${fx.b.reqA}`, { method: "PATCH", body: { title: "denied", revision: row.revision + 100 } })).status === 409);
  check("拒绝不写需求", await count("requirements") === beforeReq);
  check("拒绝不写 Bug", await count("bugs") === beforeBug);
  check("拒绝不写评论", await count("requirement_comments") === beforeComment);
  check("拒绝不修改现有业务记录", await snapshot() === beforeRows);
  for (const path of ["/projects", "/requirements", "/bugs", "/releases", "/products", "/docs/spaces", `/projects/${fx.b.projA}`, `/requirements/${fx.b.reqA}`, `/releases/${fx.v1.releaseId}`, `/products/${fx.v1.productId}`, `/docs/pages/${fx.v1.docId}`]) {
    check(`可见读取 ${path.split("/")[1]}`, (await call(path)).status === 200);
  }
  for (const path of [`/releases/${fx.b.relB}`, `/products/${fx.b.prodB}`, `/docs/pages/${fx.b.docB}`]) {
    check(`跨企业读取 ${path.split("/")[1]}`, (await call(path)).status === 404);
  }
  r = await call(`/docs/pages/${fx.v1.docId}`); const docBody = (await r.json()).data.body;
  check("文档正文不返回跨企业引用的标题快照", r.status === 200 && !docBody.includes("V1-CROSS-SNAPSHOT") && docBody.includes("需求已删除"));
  const beforeProjects = await count("projects");
  await call("/docs/spaces");
  check("读取文档空间不创建业务数据", await count("projects") === beforeProjects);
  r = await call(`/requirements?projectId=${fx.b.projA}&page=1&pageSize=2`); const list = await r.json();
  check("分页和筛选", r.status === 200 && list.meta.page === 1 && list.meta.pageSize === 2 && list.data.every((item) => item.projectId === fx.b.projA));
  r = await call("/requirements", { method: "POST", body: { title: "v1 synthetic", projectId: fx.b.projA } });
  const created = await r.json(); check("创建需求", r.status === 200 && Boolean(created.data.id));
  r = await call(`/requirements/${created.data.id}/comments`, { method: "POST", body: { body: "<p>synthetic</p>" } });
  check("添加评论", r.status === 200 && Boolean((await r.json()).data.comment.id));
  // 用例自备阶段配置，不依赖测试库原有的「需求阶段」设置；只改本次新建的隔离库。
  const setHidden = (hidden) => db.query('INSERT INTO system_settings (key, value, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()', ["reqHiddenStatuses", JSON.stringify(hidden)]);
  const statusOf = (id) => db.query("SELECT status, revision FROM requirements WHERE id = $1", [id]).then((v) => JSON.stringify(v.rows));
  await setHidden(["req_done"]);
  const beforeHidden = await statusOf(created.data.id);
  r = await call(`/requirements/${created.data.id}/status`, { method: "PATCH", body: { status: "req_done" } });
  check("停用阶段返回 400", r.status === 400);
  check("停用阶段不改需求", await statusOf(created.data.id) === beforeHidden);
  await setHidden([]);
  r = await call(`/requirements/${created.data.id}/status`, { method: "PATCH", body: { status: "req_done" } });
  check("修改需求状态", r.status === 200);
  r = await call("/bugs", { method: "POST", body: { title: "v1 synthetic bug", projectId: fx.b.projA } });
  const createdBug = await r.json(); check("创建 Bug", r.status === 200 && Boolean(createdBug.data.id));
  r = await call(`/bugs/${createdBug.data.id}`); const readBug = await r.json();
  check("读取 Bug 详情", r.status === 200 && readBug.data.id === createdBug.data.id);
  r = await call(`/bugs/${createdBug.data.id}`, { method: "PATCH", body: { title: "v1 updated", revision: readBug.data.revision } });
  check("编辑 Bug", r.status === 200);
  r = await call(`/bugs/${createdBug.data.id}/status`, { method: "PATCH", body: { status: "in_progress" } });
  check("修改 Bug 状态", r.status === 200);
  r = await call(`/bugs/${createdBug.data.id}/comments`, { method: "POST", body: { body: "<p>synthetic</p>" } });
  check("添加 Bug 评论", r.status === 200);
  // T34：补充的只读接口（成员、组织、项目进展、文档目录、周报）也按企业隔离；调用记录写入 api_access_logs
  r = await call("/members?pageSize=100"); const members = await r.json();
  check("成员列表", r.status === 200 && members.data.some((m) => m.id === fx.v1.managerId));
  check("成员列表不含乙企业的人", !JSON.stringify(members.data).includes("sec-outsider@verify.test") && !JSON.stringify(members.data).includes("sec-member2@verify.test"));
  r = await call("/orgs?pageSize=100"); const orgs = await r.json();
  check("组织架构只含本企业", r.status === 200 && orgs.data.some((o) => o.id === "sec_ent_a") && !orgs.data.some((o) => o.id === "sec_ent_b" || o.id === "sec_dept_b"));
  r = await call(`/projects/${fx.b.projA}/progress`);
  check("项目进展", r.status === 200 && typeof (await r.json()).data.requirements.total === "number");
  check("跨企业项目进展 404", (await call(`/projects/${fx.b.projB}/progress`)).status === 404);
  r = await call(`/docs/spaces/${fx.b.projA}/pages`);
  check("文档目录", r.status === 200 && (await r.json()).data.some((p) => p.id === fx.v1.docId));
  check("跨企业文档目录 404", (await call(`/docs/spaces/${fx.b.projB}/pages`)).status === 404);
  check("周报列表", (await call("/reports")).status === 200);
  check("跨企业周报 404", (await call(`/reports?projectId=${fx.b.projB}`)).status === 404);
  // T36 文档检索
  r = await call("/docs/search?q=synthetic"); const found = await r.json();
  check("文档检索命中本企业文档", r.status === 200 && found.data.some((h) => h.id === fx.v1.docId));
  r = await call(`/docs/search?q=${encodeURIComponent("机密")}`); const secret = await r.json();
  check("文档检索不返回乙企业文档", r.status === 200 && !secret.data.some((h) => h.id === fx.b.docB));
  check("指定看不到的空间检索为空", (await (await call(`/docs/search?q=${encodeURIComponent("机密")}&spaceId=${fx.b.projB}`)).json()).data.length === 0);
  check("文档检索缺关键词 400", (await call("/docs/search")).status === 400);
  check("文档检索未授予 scope 403", (await call("/docs/search?q=x", { token: fx.v1.limited })).status === 403);
  for (const path of ["/members", "/orgs", `/projects/${fx.b.projA}/progress`, `/docs/spaces/${fx.b.projA}/pages`, "/reports"]) check("补充接口未授予 scope 403", (await call(path, { token: fx.v1.limited })).status === 403);
  const logs = await db.query("SELECT action, status FROM api_access_logs WHERE channel = 'v1' AND \"userId\" = $1", [fx.v1.managerId]);
  check("开放接口调用写入调用记录", logs.rows.some((l) => l.action === "GET /members" && l.status === 200) && logs.rows.some((l) => l.action === "GET /projects/:id/progress" && l.status === 404));
  const tokenRows = () => db.query('SELECT id, "rateCount", "lastUsedAt" FROM api_tokens ORDER BY id').then((v) => JSON.stringify(v.rows));
  const beforeTokens = await tokenRows();
  const absent = `nc_pat_${randomBytes(8).toString("hex")}_${randomBytes(32).toString("base64url")}`;
  for (let i = 0; i < 60; i++) check("无效令牌 401", (await call("/me", { token: absent })).status === 401);
  check("无效令牌来源超限 429", (await call("/me", { token: absent })).status === 429);
  check("无效令牌不更新任何令牌行", await tokenRows() === beforeTokens);
  console.log(`v1 安全端到端 ${passed} 项通过`);
} catch (e) {
  console.error("v1 安全端到端失败:", e instanceof Error ? e.message : "未知错误"); process.exitCode = 1;
} finally { await db.end(); }
