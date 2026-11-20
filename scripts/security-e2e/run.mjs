/**
 * 端到端安全测试（生产构建 + PostgreSQL 测试库）：node scripts/security-e2e/run.mjs <fix.json> <测试库 DATABASE_URL> [http://localhost:3101]
 * 测试库的库名里要有 test / verify / e2e / smoke（scripts/test-db-guard.mjs），本机要有 psql。准备步骤：
 *   createdb pm_collab_verify
 *   export DATABASE_URL=postgresql://localhost:5432/pm_collab_verify
 *   npx prisma migrate deploy
 *   npx tsx scripts/migrate-sqlite-to-pg.ts --source <demo.db 的副本> --yes   # 可选：导入演示数据
 *   npx tsx scripts/security-e2e/seed.ts /tmp/fix.json
 *   npm run build && npx next start -p 3101   # 同一个 DATABASE_URL
 * 会写入数据、吊销会话、触发锁定，只能对测试库运行；重跑前重建测试库和账号（限流在进程内存里，也要重启服务）。
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { isTestDatabaseUrl } from "../test-db-guard.mjs";
const [fixPath, db, B = "http://localhost:3101"] = process.argv.slice(2);
if (!fixPath || !isTestDatabaseUrl(db)) { console.error("用法见文件头；第二个参数必须是测试库的 DATABASE_URL"); process.exit(1); }
const fx = JSON.parse(readFileSync(fixPath, "utf8"));
// 断言里的 SQL 按 SQLite 时期的写法：驼峰列名自动加双引号，布尔结果 t/f 转成 1/0
const pgify = (q) => q.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 ? part : part.replace(/\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g, '"$1"'))).join("");
const sql = (q) => {
  const out = execFileSync("psql", [db, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-c", pgify(q)], { encoding: "utf8" }).trim();
  return out === "t" ? "1" : out === "f" ? "0" : out;
};
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, d) => { c ? pass++ : (fail++, fails.push(n)); console.log(`${c ? "✓" : "✗"} ${n}${c || d === undefined ? "" : "  → " + String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 220)}`); };
const H = { Origin: B, "Content-Type": "application/json" };
async function req(path, { cookie, method = "GET", body, headers = {}, raw } = {}) {
  const hs = { ...(method !== "GET" ? H : {}), ...headers, ...(cookie ? { Cookie: cookie } : {}) };
  for (const k of Object.keys(hs)) if (hs[k] === undefined) delete hs[k];
  return fetch(B + path, { method, headers: hs, redirect: "manual", body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}
const cookieOf = (r) => { const c = r.headers.getSetCookie().find((x) => x.startsWith("pm_session=")); return c ? c.split(";")[0] : null; };
const js = async (r) => r.json().catch(() => ({}));
const login = async (key, password = fx.creds[key], remember = true) => {
  const r = await req("/api/auth/login", { method: "POST", body: { account: `sec-${key}@verify.test`, password, remember } });
  return { status: r.status, cookie: cookieOf(r), raw: r };
};
const uid = (k) => sql(`select id from users where email='sec-${k}@verify.test'`);

// 1 登录登出
const a = await login("admin");
ok("管理员登录 200", a.status === 200 && a.cookie, a.status);
const val = a.cookie.split("=")[1];
ok("Cookie 不是 JWT（无 . 分段）", !val.includes("."), val.length);
const sc = a.raw.headers.getSetCookie().find((x) => x.startsWith("pm_session="));
ok("Cookie HttpOnly + SameSite=Lax", /HttpOnly/i.test(sc) && /SameSite=lax/i.test(sc), sc.replace(val, "<v>"));
ok("库里只有令牌哈希", sql(`select count(*) from sessions where tokenHash='${val}'`) === "0" && Number(sql("select count(*) from sessions")) >= 1);
ok("会话可用", (await req("/api/meta", { cookie: a.cookie })).status === 200);
const a2 = await login("admin");
ok("登出 200", (await req("/api/auth/logout", { cookie: a2.cookie, method: "POST", body: {} })).status === 200);
ok("登出后旧 Cookie 失效 401", (await req("/api/meta", { cookie: a2.cookie })).status === 401);
ok("另一台设备不受影响", (await req("/api/meta", { cookie: a.cookie })).status === 200);
ok("伪造令牌 401", (await req("/api/meta", { cookie: "pm_session=abc" })).status === 401);
ok("旧 JWT 格式 401", (await req("/api/meta", { cookie: "pm_session=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IngifQ.xxx" })).status === 401);
ok("未登录接口 401 JSON", (await req("/api/meta")).status === 401);
ok("未登录页面跳登录", (await req("/requirements")).headers.get("location")?.includes("/login?from=%2Frequirements"));
ok("登录审计：成功", Number(sql("select count(*) from activity_logs where entityType='security' and action='login_success'")) >= 2);
ok("登录审计：登出", Number(sql("select count(*) from activity_logs where entityType='security' and action='logout'")) >= 1);

// 1b 页面在渲染前就要拦：布局挡不住并行渲染的页面。P 是真实项目
{
  const P0 = fx.req.projectId, title = fx.req.title;
  const revoked = await login("admin");
  await req("/api/auth/logout", { cookie: revoked.cookie, method: "POST", body: {} });
  for (const [n, c] of [["伪造 Cookie", "pm_session=forged"], ["已吊销 Cookie", revoked.cookie]]) {
    for (const p of [`/projects/${P0}`, `/projects/${P0}/members`, `/projects/${P0}/board`, `/projects/${P0}/requirements`, `/projects/${P0}/bugs`, `/projects/${P0}/releases`, `/projects/${P0}/plans`, `/requirements/${fx.req.id}`, "/members", "/projects", "/requirements", "/leadership", "/docs", "/products"]) {
      const r = await req(p, { cookie: c });
      const t = await r.text();
      ok(`${n}进不了 ${p.replace(P0, "P")}`, r.status >= 300 && r.status < 400 && (r.headers.get("location") || "").includes("/api/auth/logout") && !t.includes(title) && !t.includes("@"), `${r.status} ${t.length}`);
    }
  }
  const lp = await req("/login", { cookie: "pm_session=forged" });
  ok("失效 Cookie 能打开登录页", lp.status === 200);
  ok("有效会话访问登录页回首页", (await req("/login", { cookie: a.cookie })).status >= 300);
}

// 2 改密
const p1 = await login("pw"), p2 = await login("pw");
const newPw = `Nn9${fx.creds.pw.slice(3)}x`;
const cp = await req("/api/auth/change-password", { cookie: p1.cookie, method: "POST", body: { currentPassword: fx.creds.pw, newPassword: newPw } });
ok("改密成功", cp.status === 200, await cp.clone().text());
const p1n = cookieOf(cp);
ok("改密发新 Cookie", p1n && p1n !== p1.cookie);
ok("改密后本设备旧 Cookie 失效", (await req("/api/meta", { cookie: p1.cookie })).status === 401);
ok("改密后其他设备失效", (await req("/api/meta", { cookie: p2.cookie })).status === 401);
ok("改密后新 Cookie 可用", (await req("/api/meta", { cookie: p1n })).status === 200);
ok("旧密码登录失败", (await login("pw")).status === 401);
ok("新密码登录成功", (await login("pw", newPw)).status === 200);
ok("新哈希强度 12", sql("select substr(passwordHash,5,2) from users where email='sec-pw@verify.test'") === "12");

// 3 停用
const off = await login("off");
ok("停用前可用", (await req("/api/meta", { cookie: off.cookie })).status === 200);
const offId = uid("off");
ok("管理员停用 200", (await req("/api/users", { cookie: a.cookie, method: "PATCH", body: { id: offId, isActive: false } })).status === 200);
ok("停用后立即 401", (await req("/api/meta", { cookie: off.cookie })).status === 401);
ok("停用后不能登录", (await login("off")).status === 401);
ok("会话已写 revokedAt", sql(`select count(*) from sessions where userId='${offId}' and revokedAt is null`) === "0");
await req("/api/users", { cookie: a.cookie, method: "PATCH", body: { id: offId, isActive: true } });
ok("恢复后旧会话仍然无效", (await req("/api/meta", { cookie: off.cookie })).status === 401);
ok("账号变更有审计", Number(sql(`select count(*) from activity_logs where entityType='user' and entityId='${offId}'`)) >= 1);
ok("审计里没有密码", sql("select count(*) from activity_logs where entityType='user' and (toValue like '%passwordHash%' or toValue like '%$2%')") === "0");

// 4 改角色
const rl = await login("role");
const rlId = uid("role");
await req("/api/users", { cookie: a.cookie, method: "PATCH", body: { id: rlId, globalRole: "guest" } });
ok("改角色后旧会话失效", (await req("/api/meta", { cookie: rl.cookie })).status === 401);
const rl2 = await login("role");
const rlBatch = await req("/api/users/batch", { cookie: a.cookie, method: "PATCH", body: { ids: [rlId], globalRole: "member" } });
ok("批量改角色后旧会话失效", rlBatch.status === 200 && (await req("/api/meta", { cookie: rl2.cookie })).status === 401);

// 5 锁定
let codes = [];
for (let i = 0; i < 6; i++) codes.push((await login("lock", "wrong-password-1")).status);
ok("连续错 5 次第 5 次 429", codes[3] === 401 && codes[4] === 429 && codes[5] === 429, codes);
const lk = await login("lock");
ok("锁定中正确密码也 429", lk.status === 429 && !lk.cookie, lk.status);
ok("带 Retry-After", Number(lk.raw.headers.get("retry-after")) > 0);
ok("失败和锁定有审计", Number(sql("select count(*) from activity_logs where entityType='security' and action='login_failed'")) >= 4 && Number(sql("select count(*) from activity_logs where entityType='security' and action='login_locked'")) >= 1);
const un = await req("/api/auth/login", { method: "POST", body: { account: "no-such@verify.test", password: "x" } });
ok("不存在账号提示相同", un.status === 401 && (await js(un)).error === "账号或密码错误");
ok("伪造内部 IP 头不能绕过", (await req("/api/auth/login", { method: "POST", headers: { "X-PM-Client-IP": "9.9.9.8" }, body: { account: "sec-lock@verify.test", password: fx.creds.lock } })).status === 429);
ok("伪造 XFF 不能绕过", (await req("/api/auth/login", { method: "POST", headers: { "X-Forwarded-For": "9.9.9.9" }, body: { account: "sec-lock@verify.test", password: fx.creds.lock } })).status === 429);

// 6 CSRF
const evil = { Origin: "https://evil.example" };
ok("跨站 POST 被拒 403", (await req("/api/requirements", { cookie: a.cookie, method: "POST", headers: evil, body: { title: "csrf" } })).status === 403);
ok("跨站 PATCH 被拒", (await req("/api/users", { cookie: a.cookie, method: "PATCH", headers: evil, body: {} })).status === 403);
ok("跨站 DELETE 被拒", (await req("/api/users?id=x", { cookie: a.cookie, method: "DELETE", headers: evil })).status === 403);
ok("跨站登录被拒", (await req("/api/auth/login", { method: "POST", headers: evil, body: { account: "x", password: "y" } })).status === 403);
ok("Origin:null 被拒", (await req("/api/requirements", { cookie: a.cookie, method: "POST", headers: { Origin: "null" }, body: {} })).status === 403);
ok(".png 结尾的接口路径也被拦", (await req("/api/requirements/x.png", { cookie: a.cookie, method: "PATCH", headers: evil, body: {} })).status === 403);
ok("Sec-Fetch-Site 跨站被拒", (await req("/api/requirements", { cookie: a.cookie, method: "POST", headers: { Origin: undefined, "Sec-Fetch-Site": "cross-site" }, body: {} })).status === 403);
ok("X-Forwarded-Host 伪造无效", (await req("/api/requirements", { cookie: a.cookie, method: "POST", headers: { ...evil, "X-Forwarded-Host": "evil.example" }, body: {} })).status === 403);
const good = await req("/api/requirements", { cookie: a.cookie, method: "POST", body: { title: "同源写入", projectId: fx.req.projectId } });
ok("同源 POST 正常", good.status === 200, await good.clone().text());
const ownReq = (await js(good)).id;

// 7 XSS 清洗
const xss = `<p>ok</p><img src="/api/attachments/cabc123def456" onerror="alert(1)"><img src=x onerror=alert(2)><a href="javascript:alert(3)">j</a><a href="JaVaScRiPt:alert(4)">k</a><script>alert(5)</script><a href="https://ok.example/">fine</a>`;
const sp = sql(`select id from projects where status='active' limit 1`);
const pg = await js(await req("/api/docs/pages", { cookie: a.cookie, method: "POST", body: { spaceId: sp, title: "xss" } }));
ok("新建文档", !!pg.id, pg);
ok("草稿保存", (await req(`/api/docs/pages/${pg.id}`, { cookie: a.cookie, method: "PATCH", body: { body: xss } })).status === 200);
ok("发布", (await req(`/api/docs/pages/${pg.id}/publish`, { cookie: a.cookie, method: "POST", body: { title: "xss", body: xss } })).status === 200);
const stored = sql(`select body from doc_pages where id='${pg.id}'`);
ok("入库内容无 onerror / javascript / script", !/onerror|javascript:|<script|alert/i.test(stored), stored);
ok("合法内容保留", stored.includes('src="/api/attachments/cabc123def456"') && stored.includes('href="https://ok.example/"') && stored.includes('rel="noopener noreferrer"'), stored);
const view = await (await req(`/docs/${sp}/pages/${pg.id}`, { cookie: a.cookie })).text();
ok("阅读页无 onerror / javascript 协议", !/onerror=|href="javascript:/i.test(view));
const cm = await req(`/api/requirements/${ownReq}/comments`, { cookie: a.cookie, method: "POST", body: { body: xss } });
ok("评论清洗", !/onerror|javascript:|<script/i.test((await js(cm)).comment?.body || "x"));
await req(`/api/requirements/${ownReq}`, { cookie: a.cookie, method: "PATCH", body: { descriptionHtml: xss } });
ok("需求描述清洗", !/onerror|javascript:|<script/i.test(sql(`select descriptionHtml from requirements where id='${ownReq}'`)));

// 8 上传
const up = async (name, type, bytes, path = "/api/attachments", extra = { kind: "image" }, field = "file") => {
  const fd = new FormData(); fd.append(field, new File([bytes], name, { type }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fetch(B + path, { method: "POST", headers: { Origin: B, Cookie: a.cookie }, body: fd, redirect: "manual" });
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
ok("真实 PNG 通过", (await up("a.png", "image/png", PNG)).status === 200);
ok("HTML 冒充 PNG 被拒", (await up("a.png", "image/png", Buffer.from("<html><script>alert(1)</script>"))).status === 400);
ok("SVG 被拒（配图）", (await up("a.svg", "image/svg+xml", Buffer.from("<svg onload=alert(1)>"))).status === 400);
ok("超过 5MB 被拒", (await up("a.png", "image/png", Buffer.concat([PNG, Buffer.alloc(5.2 * 1024 * 1024)]))).status === 400);
ok("exe 冒充 PDF 被拒", (await up("a.pdf", "application/pdf", Buffer.from("MZ\0\0"), "/api/attachments", { kind: "file" })).status === 400);
const lie = await up("x.exe", "image/gif", PNG);
const lied = await js(lie);
ok("MIME 以内容为准", lie.status === 200 && lied.mime === "image/png", lied);
ok("头像拒绝假图片", (await up("a.png", "image/png", Buffer.from("not an image"), "/api/auth/avatar", {})).status === 400);
const av = await up("../../evil.png", "image/png", PNG, "/api/auth/avatar", {});
const avj = await js(av);
ok("头像文件名随机", av.status === 200 && /^\/uploads\/avatars\/[0-9a-f]{32}\.png$/.test(avj.avatarUrl), avj);
if (avj.avatarUrl) { const g = await req(avj.avatarUrl); ok("头像可读取", g.status === 200 && g.headers.get("content-type") === "image/png", g.status); await req("/api/auth/avatar", { cookie: a.cookie, method: "DELETE", body: {} }); }
for (const p of ["/uploads/avatars/..%2f..%2f.env", "/uploads/avatars/..%2f..%2fprisma%2fdev.db", "/uploads/projects/%2e%2e%2f%2e%2e%2f.env.png", "/uploads/avatars/....//.env", "/api/auth/avatar/file/..%2f..%2f..%2f.env", "/api/projects/icon/file/..%2f..%2f..%2fpackage.json"]) {
  let r = await req(p);
  // Next 规范化重复斜杠时先 308，跟随一次看最终结果
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) r = await req(new URL(r.headers.get("location"), B).pathname);
  const t = await r.text();
  ok(`路径穿越 ${p}`, r.status >= 400 && !/AUTH_SECRET|DATABASE_URL|"dependencies"|SQLite format/.test(t), r.status);
}

// 9 越权：member 不在任何项目里
const m = await login("member"); const g = await login("guest");
const P = fx.req.projectId, R = fx.req.id;
const rel = await js(await req("/api/releases", { cookie: a.cookie, method: "POST", body: { projectId: P, version: `9.9.${Date.now() % 1000}` } }));
const att = (await js(await up("b.png", "image/png", PNG))).id;
await req(`/api/requirements/${R}`, { cookie: a.cookie, method: "PATCH", body: { descriptionHtml: `<p>x</p><img src="/api/attachments/${att}">` } });
ok("member 确实不在项目里", sql(`select count(*) from project_members m join users u on u.id=m.userId where u.email='sec-member@verify.test'`) === "0");
const pool = await js(await req(`/api/requirements?projectId=${P}`, { cookie: m.cookie }));
ok("读项目需求列表为空", (pool.items || []).length === 0, pool);
ok("读别项目详情 404", (await req(`/api/projects/${P}`, { cookie: m.cookie })).status === 404);
ok("读别项目资料 404", (await req(`/api/projects/${P}/resources`, { cookie: m.cookie })).status === 404);
ok("读别项目成员 404", (await req(`/api/projects/${P}/members`, { cookie: m.cookie })).status === 404);
ok("读别项目背景图 404", (await req(`/api/projects/${P}/cover`, { cookie: m.cookie })).status === 404);
ok("读发版列表为空", ((await js(await req(`/api/releases?projectId=${P}`, { cookie: m.cookie }))).items || []).length === 0);
ok("读评论 404", (await req(`/api/requirements/${R}/comments`, { cookie: m.cookie })).status === 404);
ok("发评论 404", (await req(`/api/requirements/${R}/comments`, { cookie: m.cookie, method: "POST", body: { body: "<p>x</p>" } })).status === 404);
ok("改需求 404", (await req(`/api/requirements/${R}`, { cookie: m.cookie, method: "PATCH", body: { title: "hack" } })).status === 404);
ok("改状态 404", (await req(`/api/requirements/${R}/status`, { cookie: m.cookie, method: "PATCH", body: { status: "dev_in_progress" } })).status === 404);
ok("读附件 404", (await req(`/api/attachments/${att}`, { cookie: m.cookie })).status === 404);
ok("管理员能读同一附件", (await req(`/api/attachments/${att}`, { cookie: a.cookie })).status === 200);
const tb = await js(await req(`/api/requirements/to-bugs`, { cookie: m.cookie, method: "POST", body: { ids: [R], keep: true, dryRun: true } }));
ok("移入 Bug 看不到别项目需求", tb.ok === 0, tb);
const tg = await js(await req(`/api/title-gen/bulk`, { cookie: m.cookie, method: "POST", body: { kind: "requirement", ids: [R] } }));
ok("批量标题不返回别项目内容", (tg.items || []).length === 0, tg);
ok("AI 助手指定别项目 404", (await req(`/api/assistant`, { cookie: m.cookie, method: "POST", body: { message: "状态", projectId: P } })).status === 404);
const as = await js(await req(`/api/assistant`, { cookie: g.cookie, method: "POST", body: { message: "按状态分组" } }));
ok("AI 助手不含别项目数据", !JSON.stringify(as).includes(fx.req.title) && !(as.sections || []).length, as);
ok("管理员的助手有数据", ((await js(await req(`/api/assistant`, { cookie: a.cookie, method: "POST", body: { message: "按状态分组" } }))).sections || []).length > 0);
ok("页面：别项目 404", (await req(`/projects/${P}`, { cookie: m.cookie })).status === 404);
ok("页面：发版详情 404", (await req(`/releases/${rel.id}`, { cookie: m.cookie })).status === 404);
ok("页面：需求详情 404", (await req(`/requirements/${R}`, { cookie: m.cookie })).status === 404);
ok("写接口：产品节点无范围 404", (await req(`/api/products/${fx.prod.id}/nodes`, { cookie: m.cookie, method: "POST", body: { name: "x" } })).status === 404);
ok("读产品详情 404", (await req(`/api/products/${fx.prod.id}`, { cookie: m.cookie })).status === 404);
ok("生命周期删产品被拒", (await req(`/api/lifecycle`, { cookie: m.cookie, method: "POST", body: { kind: "product", id: fx.prod.id, action: "delete" } })).status === 400);
ok("产品还在", sql(`select deletedAt is null from products where id='${fx.prod.id}'`) === "1");

// 10 角色层级：系统管理员 > 管理者 > 成员和自定义角色 > 访客
const mg = await login("manager");
const mgId = uid("manager"), mg2Id = uid("manager2"), adId = uid("admin2"), tgId = uid("target");
const patch = (cookie, body) => req("/api/users", { cookie, method: "PATCH", body });
const batch = (cookie, body) => req("/api/users/batch", { cookie, method: "PATCH", body });
ok("管理者不能给自己升管理员", (await patch(mg.cookie, { id: mgId, globalRole: "admin" })).status === 403);
ok("管理者批量升自己被拒", (await batch(mg.cookie, { ids: [mgId], globalRole: "admin" })).status === 403);
ok("管理者不能改自己账号", (await patch(mg.cookie, { id: mgId, name: "x" })).status === 403);
ok("管理者不能重置管理员密码", (await patch(mg.cookie, { id: adId, password: "Abcdefgh1234" })).status === 403);
ok("管理者不能停用管理员", (await patch(mg.cookie, { id: adId, isActive: false })).status === 403);
ok("管理者不能删管理员", (await req(`/api/users?id=${adId}`, { cookie: mg.cookie, method: "DELETE" })).status === 403);
ok("管理者不能新建管理员", (await req("/api/users", { cookie: mg.cookie, method: "POST", body: { name: "x", account: "sec-x@verify.test", globalRole: "admin" } })).status === 403);
ok("管理者不能新建管理者", (await req("/api/users", { cookie: mg.cookie, method: "POST", body: { name: "x", account: "sec-y@verify.test", globalRole: "manager" } })).status === 403);
ok("管理者不能改同级管理者", (await patch(mg.cookie, { id: mg2Id, globalRole: "member" })).status === 403);
ok("管理者不能重置同级密码", (await patch(mg.cookie, { id: mg2Id, password: "Abcdefgh1234" })).status === 403);
ok("管理者不能停用同级", (await patch(mg.cookie, { id: mg2Id, isActive: false })).status === 403);
ok("管理者不能删同级", (await req(`/api/users?id=${mg2Id}`, { cookie: mg.cookie, method: "DELETE" })).status === 403);
ok("批量里混入同级被拒", (await batch(mg.cookie, { ids: [tgId, mg2Id], position: "" })).status === 403);
ok("不能把成员升管理者", (await patch(mg.cookie, { id: tgId, globalRole: "manager" })).status === 403);
ok("不能把成员升管理员", (await patch(mg.cookie, { id: tgId, globalRole: "admin" })).status === 403);
ok("批量升管理者被拒", (await batch(mg.cookie, { ids: [tgId], globalRole: "manager" })).status === 403);
ok("角色都没变", sql(`select globalRole from users where id='${mgId}'`) === "manager" && sql(`select globalRole from users where id='${tgId}'`) === "member" && sql(`select globalRole from users where id='${mg2Id}'`) === "manager");
ok("管理者能把成员改成访客", (await patch(mg.cookie, { id: tgId, globalRole: "guest" })).status === 200);
ok("管理者能批量改回成员", (await batch(mg.cookie, { ids: [tgId], globalRole: "member" })).status === 200);
ok("管理者能改下级资料", (await patch(mg.cookie, { id: tgId, name: "sec-target2" })).status === 200);
{ const rp = await patch(mg.cookie, { id: tgId, resetPassword: true }); ok("管理者能给下级发重置链接", rp.status === 200 && String((await js(rp)).resetLink || "").includes("/invite/")); }
ok("普通成员无账号管理", (await req("/api/users", { cookie: m.cookie })).status === 403);
// 管理范围：只限自己所属二级组织及下级
const outId = uid("outsider"), rootId = uid("rootuser");
ok("不能改别的二级组织的人", (await patch(mg.cookie, { id: outId, name: "x" })).status === 403);
ok("不能改别的二级组织的人的角色", (await patch(mg.cookie, { id: outId, globalRole: "guest" })).status === 403);
ok("不能重置别的二级组织的人的密码", (await patch(mg.cookie, { id: outId, password: "Abcdefgh1234" })).status === 403);
ok("不能删别的二级组织的人", (await req(`/api/users?id=${outId}`, { cookie: mg.cookie, method: "DELETE" })).status === 403);
ok("批量混入别的二级组织被拒", (await batch(mg.cookie, { ids: [tgId, outId], position: "" })).status === 403);
ok("不能改系统组织直属的人", (await patch(mg.cookie, { id: rootId, name: "x" })).status === 403);
ok("不能把下级移出二级组织", (await patch(mg.cookie, { id: tgId, orgId: "sec_dept_b" })).status === 403);
ok("批量移出被拒", (await batch(mg.cookie, { ids: [tgId], orgId: "sec_dept_b" })).status === 403);
ok("二级组织内跨部门可以", (await patch(mg.cookie, { id: tgId, orgId: "sec_dept_a" })).status === 200);
ok("不能在别的组织建账号", (await req("/api/users", { cookie: mg.cookie, method: "POST", body: { name: "x", account: "sec-z1@verify.test", orgId: "sec_dept_b" } })).status === 403);
ok("默认组织（系统组织）建账号被拒", (await req("/api/users", { cookie: mg.cookie, method: "POST", body: { name: "x", account: "sec-z2@verify.test" } })).status === 403);
ok("能在本组织建账号", (await req("/api/users", { cookie: mg.cookie, method: "POST", body: { name: "x", account: "sec-z3@verify.test", orgId: "sec_dept_a2" } })).status === 200);
const seen = await js(await req("/api/users", { cookie: mg.cookie }));
const seenIds = (seen.users || []).map((u) => u.id);
ok("账号列表只有本组织和自己", seenIds.includes(tgId) && seenIds.includes(mgId) && !seenIds.includes(outId) && !seenIds.includes(rootId) && !seenIds.includes(adId), seenIds.length);
ok("系统管理员看全部", ((await js(await req("/api/users", { cookie: a.cookie }))).users || []).some((u) => u.id === outId));
ok("系统管理员能改任何组织的人", (await patch(a.cookie, { id: outId, name: "sec-outsider2" })).status === 200);
// 组织和全局配置
ok("管理者不能建企业", (await req("/api/orgs", { cookie: mg.cookie, method: "POST", body: { name: "偷建", type: "enterprise", parentId: "org_nova_collab" } })).status === 403);
ok("管理者不能在别的企业建部门", (await req("/api/orgs", { cookie: mg.cookie, method: "POST", body: { name: "偷建", type: "department", parentId: "sec_ent_b" } })).status === 403);
const nd = await req("/api/orgs", { cookie: mg.cookie, method: "POST", body: { name: "新部门", type: "department", parentId: "sec_ent_a" } });
ok("管理者能在本企业建部门", nd.status === 200);
const ndId = (await js(nd)).org?.id;
ok("管理者能改本企业部门", (await req(`/api/orgs/${ndId}`, { cookie: mg.cookie, method: "PATCH", body: { name: "新部门2" } })).status === 200);
ok("不能把部门移到别的企业", (await req(`/api/orgs/${ndId}`, { cookie: mg.cookie, method: "PATCH", body: { parentId: "sec_ent_b" } })).status === 403);
ok("管理者能删本企业部门", (await req(`/api/orgs/${ndId}`, { cookie: mg.cookie, method: "DELETE" })).status === 200);
ok("不能改二级组织本身", (await req("/api/orgs/sec_ent_a", { cookie: mg.cookie, method: "PATCH", body: { name: "改名" } })).status === 403);
ok("不能删二级组织", (await req("/api/orgs/sec_ent_a", { cookie: mg.cookie, method: "DELETE" })).status === 403);
ok("不能改别的企业的部门", (await req("/api/orgs/sec_dept_b", { cookie: mg.cookie, method: "PATCH", body: { name: "改名" } })).status === 403);
const og = await js(await req("/api/orgs", { cookie: mg.cookie }));
const ogIds = (og.orgs || []).map((o) => o.id);
ok("组织树看不到别的二级组织", ogIds.includes("sec_ent_a") && !ogIds.includes("sec_ent_b") && !ogIds.includes("sec_dept_b"), ogIds);
ok("管理者不能改系统设置", (await req("/api/system/settings", { cookie: mg.cookie, method: "PUT", body: { name: "改名" } })).status === 403);
ok("管理者不能改需求阶段", (await req("/api/system/req-stages", { cookie: mg.cookie, method: "POST", body: { hidden: [] } })).status === 403);
ok("管理者不能调 ITR 同步", (await req("/api/sync/itr", { cookie: mg.cookie, method: "POST", body: {} })).status === 403);
ok("管理者不能改岗位", (await req("/api/positions", { cookie: mg.cookie, method: "POST", body: { name: "偷建" } })).status === 403);
ok("管理者读不到飞书配置", (await req("/api/system/feishu", { cookie: mg.cookie })).status === 403);
// 角色权限矩阵只有系统管理员能改
const memberRole = sql("select id from roles where key='member'");
ok("管理者不能改权限矩阵", (await req("/api/permissions", { cookie: mg.cookie, method: "PATCH", body: { role: "member", feature: "users.manage", allowed: true } })).status === 403);
ok("管理者不能改角色", (await req("/api/roles", { cookie: mg.cookie, method: "PATCH", body: { id: memberRole, permissions: { "users.manage": true } } })).status === 403);
ok("管理者不能新建角色", (await req("/api/roles", { cookie: mg.cookie, method: "POST", body: { name: "偷权" } })).status === 403);
ok("管理者不能删角色", (await req(`/api/roles?id=${memberRole}`, { cookie: mg.cookie, method: "DELETE" })).status === 403);
const nr = await js(await req("/api/roles", { cookie: a.cookie, method: "POST", body: { name: "带账号管理", copyFrom: "member", permissions: { "users.manage": true } } }));
ok("系统管理员能新建角色", !!nr.role?.key, nr);
ok("系统管理员能改矩阵", (await req("/api/permissions", { cookie: a.cookie, method: "PATCH", body: { role: "guest", feature: "docs.edit", allowed: false } })).status === 200);
ok("管理者不能授予带账号管理权限的角色", (await patch(mg.cookie, { id: tgId, globalRole: nr.role.key })).status === 403);
ok("系统管理员能升管理者", (await patch(a.cookie, { id: tgId, globalRole: "manager" })).status === 200);
ok("系统管理员能撤销管理者", (await patch(a.cookie, { id: tgId, globalRole: "member" })).status === 200);
// 前端入口
const rsc = (html, key) => { const x = new RegExp(`\\\\?"${key}\\\\?":\\[(.*?)\\]`).exec(html)?.[1] ?? ""; return x.replace(/\\/g, ""); };
const mh = await (await req("/members", { cookie: (await login("manager")).cookie })).text();
const assign = rsc(mh, "assignableRoles");
ok("成员页：管理者可选角色不含管理员和管理者", assign.includes('"member"') && !assign.includes('"admin"') && !assign.includes('"manager"'), assign);
ok("成员页：管理者可操作的角色不含同级", !rsc(mh, "manageableRoles").includes('"manager"'), rsc(mh, "manageableRoles"));
ok("成员页：看不到别的二级组织的人和组织", !mh.includes("sec-outsider") && !mh.includes("sec_ent_b") && mh.includes("sec-manager"));
const ph = await (await req("/permissions", { cookie: (await login("manager")).cookie })).text();
ok("角色权限页：管理者只读", /canEdit\\?":false/.test(ph));
ok("角色权限页：系统管理员可编辑", /canEdit\\?":true/.test(await (await req("/permissions", { cookie: a.cookie })).text()));

// 10b 企业隔离：manager 在甲企业（数据范围「本企业」），outsider 是乙企业的成员，参与乙企业项目
const b = fx.b;
const ma = (await login("manager")).cookie, ob = (await login("outsider")).cookie, m2 = (await login("member2")).cookie, ru = (await login("rootuser")).cookie;
const SECRET = /乙企业/;
ok("角色的全部数据已改成本企业", sql("select dataScope from roles where key='manager'") === "enterprise");
ok("角色不能再选全部数据", (await req("/api/roles", { cookie: a.cookie, method: "PATCH", body: { id: sql("select id from roles where key='member'"), dataScope: "all" } })).status === 400);
for (const [n, p] of [["项目详情", `/api/projects/${b.projB}`], ["项目资料", `/api/projects/${b.projB}/resources`], ["项目成员", `/api/projects/${b.projB}/members`], ["项目页", `/projects/${b.projB}`], ["项目看板页", `/projects/${b.projB}/board`], ["项目需求页", `/projects/${b.projB}/requirements`], ["需求详情页", `/requirements/${b.reqB}`], ["公共池需求详情页", `/requirements/${b.poolB}`], ["需求评论", `/api/requirements/${b.reqB}/comments`], ["Bug 接口", `/api/bugs/${b.bugB}`], ["Bug 详情页", `/bugs/${b.bugB}`], ["Bug 备注", `/api/bugs/${b.bugB}/comments`], ["发版详情页", `/releases/${b.relB}`], ["文档页", `/docs/${b.projB}/pages/${b.docB}`], ["产品接口", `/api/products/${b.prodB}`], ["产品页", `/products/${b.prodB}`], ["附件", `/api/attachments/${b.attB}`]]) {
  const r = await req(p, { cookie: ma });
  const t = await r.text();
  ok(`跨企业读 404：${n}`, (r.status === 404 || r.status === 403) && !/乙企业(机密|项目|产品|公共池)/.test(t), `${r.status}`);
}
// 两种入口都不应把乙企业项目或需求写入甲企业的新建页响应。
for (const query of [`project=${encodeURIComponent(b.projB)}`, `requirement=${encodeURIComponent(b.reqB)}`]) {
  const response = await req(`/bugs/new?${query}`, { cookie: ma });
  const html = await response.text();
  ok("新建 Bug 页不泄露跨企业项目或需求", response.status === 200 && !html.includes("乙企业项目SEC") && !html.includes("乙企业机密需求SEC"), response.status);
}
const ownBugPage = await req(`/bugs/new?project=${encodeURIComponent(b.projA)}`, { cookie: ma });
ok("新建 Bug 页能显示本企业项目", ownBugPage.status === 200 && (await ownBugPage.text()).includes("甲企业项目SEC"), ownBugPage.status);
// 新建需求页：?project= / ?parent= 带乙企业 id 时按不存在处理，本企业正常
for (const query of [`project=${encodeURIComponent(b.projB)}`, `parent=${encodeURIComponent(b.reqB)}`]) {
  const response = await req(`/requirements/new?${query}`, { cookie: ma });
  const html = await response.text();
  ok(`新建需求页不泄露跨企业${query.startsWith("project") ? "项目" : "父需求"}`, response.status === 200 && !html.includes("乙企业项目SEC") && !html.includes("乙企业机密需求SEC"), response.status);
}
const ownReqPage = await req(`/requirements/new?project=${encodeURIComponent(b.projA)}`, { cookie: ma });
ok("新建需求页能显示本企业项目", ownReqPage.status === 200 && (await ownReqPage.text()).includes("甲企业项目SEC"), ownReqPage.status);
// 新建需求 / 发版、把需求移到别的项目：跨企业项目和不存在的 id 返回同样的 404
for (const [n, path, method, body] of [
  ["新建需求", "/api/requirements", "POST", (pid) => ({ title: "x", projectId: pid })],
  ["新建发版", "/api/releases", "POST", (pid) => ({ projectId: pid, version: "9.9.9" })],
  ["需求移到别的项目", `/api/requirements/${b.reqA}`, "PATCH", (pid) => ({ projectId: pid })],
  // T32：其余带项目 / 空间 id 的写接口也按不存在处理
  ["新建 Bug", "/api/bugs", "POST", (pid) => ({ title: "x", projectId: pid })],
  ["Bug 移到别的项目", `/api/bugs/${b.bugA1}`, "PATCH", (pid) => ({ projectId: pid })],
  ["紧急发版", "/api/releases/hotfix", "POST", (pid) => ({ projectId: pid, version: "9.9.8", reason: "x" })],
  ["新建文档页", "/api/docs/pages", "POST", (pid) => ({ spaceId: pid, title: "x" })],
  ["新建云表格连接", "/api/feishu-tables", "POST", (pid) => ({ name: "x", url: "https://x.feishu.cn/sheets/abc", projectId: pid })],
]) {
  const cross = await req(path, { cookie: ma, method, body: body(b.projB) });
  const none = await req(path, { cookie: ma, method, body: body("no-such-project") });
  const [ct, nt] = [await cross.text(), await none.text()];
  ok(`${n}：跨企业项目与不存在 id 一致（404）`, cross.status === 404 && none.status === 404 && ct === nt, `${cross.status} ${none.status}`);
}
ok("跨企业改需求 404", (await req(`/api/requirements/${b.reqB}`, { cookie: ma, method: "PATCH", body: { title: "x" } })).status === 404);
ok("跨企业改公共池需求 404", (await req(`/api/requirements/${b.poolB}`, { cookie: ma, method: "PATCH", body: { title: "x" } })).status === 404);
ok("跨企业改状态 404", (await req(`/api/requirements/${b.reqB}/status`, { cookie: ma, method: "PATCH", body: { status: "test_in_progress" } })).status === 404);
ok("跨企业改 Bug 404", (await req(`/api/bugs/${b.bugB}`, { cookie: ma, method: "PATCH", body: { title: "x" } })).status === 404);
ok("跨企业改 Bug 状态 404", (await req(`/api/bugs/${b.bugB}/status`, { cookie: ma, method: "PATCH", body: { status: "closed" } })).status === 404);
ok("跨企业删需求被拒", (await req(`/api/requirements/${b.reqB}`, { cookie: ma, method: "DELETE" })).status === 400);
ok("跨企业删 Bug 被拒", (await req("/api/lifecycle", { cookie: ma, method: "POST", body: { kind: "bug", id: b.bugB, action: "delete" } })).status === 400);
// Bug 批量删除：逐条校验、越权不删、软删除可恢复、权限矩阵生效
const bd = (cookie, ids, extra = {}) => req("/api/bugs/bulk-delete", { cookie, method: "POST", body: { ids }, ...extra });
const gone = (id) => sql(`select deletedAt is not null from bugs where id='${id}'`) === "1";
ok("批量删除未登录 401", (await bd(undefined, [b.bugA1])).status === 401);
ok("批量删除外站 Origin 被拦", (await bd(ma, [b.bugA1], { headers: { Origin: "https://evil.example" } })).status === 403 && !gone(b.bugA1));
ok("批量删除空列表 400", (await bd(ma, [])).status === 400);
ok("批量删除超上限 400", (await bd(ma, Array.from({ length: 201 }, (_, i) => `x${i}`))).status === 400);
{
  const r = await js(await bd(ob, [b.bugB]));
  ok("成员默认没有删除权限", r.deleted?.length === 0 && r.skipped?.[0]?.reason === "没有删除权限" && !gone(b.bugB), r);
  ok("成员走单条删除也被拒", (await req("/api/lifecycle", { cookie: ob, method: "POST", body: { kind: "bug", id: b.bugB, action: "delete" } })).status === 400 && !gone(b.bugB));
  const x = await js(await bd(ma, [b.bugA1, b.bugA2, b.bugA1, b.bugB, "no-such-bug"]));
  ok("批量删除只删有权限的，重复 id 去重", x.deleted?.length === 2 && gone(b.bugA1) && gone(b.bugA2), x);
  const why = (id) => x.skipped?.find((s) => s.id === id)?.reason;
  ok("跨企业 Bug 不删", !gone(b.bugB) && why(b.bugB) === "不存在或无权访问", x);
  ok("别的企业和不存在的返回相同原因", why(b.bugB) === why("no-such-bug"), x);
  ok("批量删除写动态", sql(`select count(*) from activity_logs where entityId='${b.bugA1}' and action='lifecycle_delete'`) === "1");
  ok("删除后接口 404、数据还在", (await req(`/api/bugs/${b.bugA1}`, { cookie: ma })).status === 404 && sql(`select count(*) from bugs where id='${b.bugA1}'`) === "1");
  ok("回收站里的 Bug 不能改", (await req(`/api/bugs/${b.bugA1}`, { cookie: ma, method: "PATCH", body: { title: "x" } })).status === 404 && (await req(`/api/bugs/${b.bugA1}/status`, { cookie: ma, method: "PATCH", body: { status: "closed" } })).status === 404);
  ok("重复删除被跳过", (await js(await bd(ma, [b.bugA1]))).skipped?.length === 1);
  ok("回收站列出批量删除的 Bug", ((await js(await req("/api/lifecycle?tab=trash", { cookie: ma }))).items || []).some((i) => i.id === b.bugA1));
  ok("成员不能恢复", (await req("/api/lifecycle", { cookie: ob, method: "POST", body: { kind: "bug", id: b.bugA1, action: "restore" } })).status === 400 && gone(b.bugA1));
  ok("回收站恢复", (await req("/api/lifecycle", { cookie: ma, method: "POST", body: { kind: "bug", id: b.bugA1, action: "restore" } })).status === 200 && !gone(b.bugA1));
  const perm = (role, on) => sql(`insert into role_permissions (id, scope, role, feature, allowed) values ('sec-${role}-bd', 'role', '${role}', 'bugs.delete', ${on ? "true" : "false"})`);
  perm("manager", 0);
  ok("矩阵关掉管理者后不能删", (await js(await bd(ma, [b.bugA3]))).skipped?.[0]?.reason === "没有删除权限" && !gone(b.bugA3));
  sql("delete from role_permissions where id='sec-manager-bd'");
  perm("member", 1);
  const on = await js(await bd(ob, [b.bugB2, b.bugA3]));
  ok("矩阵打开成员后能删本范围，仍不能跨企业", on.deleted?.[0] === b.bugB2 && on.deleted.length === 1 && !gone(b.bugA3), on);
  sql("delete from role_permissions where id='sec-member-bd'");
  const list = (c) => req(`/projects/${b.projA}/bugs`, { cookie: c }).then((r) => r.text());
  ok("有权限的列表显示行内删除入口", (await list(ma)).includes("更多操作"));
  const pb = await (await req(`/projects/${b.projB}/bugs`, { cookie: ob })).text();
  ok("没权限的列表不显示行内删除入口", pb.includes("乙企业机密BugSEC") && !pb.includes("更多操作"));
}
ok("跨企业删项目被拒", (await req("/api/lifecycle", { cookie: ma, method: "POST", body: { kind: "project", id: b.projB, action: "delete" } })).status === 400);
ok("跨企业删产品被拒", (await req("/api/lifecycle", { cookie: ma, method: "POST", body: { kind: "product", id: b.prodB, action: "delete" } })).status === 400);
ok("跨企业改发版 404", [404].includes((await req(`/api/releases/${b.relB}`, { cookie: ma, method: "PATCH", body: { title: "x" } })).status));
ok("跨企业改文档被拒", [403, 404].includes((await req(`/api/docs/pages/${b.docB}`, { cookie: ma, method: "PATCH", body: { body: "<p>x</p>" } })).status));
ok("不能往别的企业项目建需求（404）", (await req("/api/requirements", { cookie: ma, method: "POST", body: { title: "x", projectId: b.projB } })).status === 404);
ok("不能往别的企业项目提 Bug（404）", (await req("/api/bugs", { cookie: ma, method: "POST", body: { title: "x", projectId: b.projB } })).status === 404);
ok("跨企业数据没被改", sql(`select title from requirements where id='${b.reqB}'`) === "乙企业机密需求SEC" && sql(`select deletedAt is null from projects where id='${b.projB}'`) === "1");
ok("批量设置碰不到别的企业", (await js(await req("/api/requirements/bulk", { cookie: ma, method: "POST", body: { ids: [b.reqB], patch: { priority: "p0" }, dryRun: true } }))).ok === 0);
// 列表、统计、搜索、AI
for (const [n, p] of [["工作台", "/"], ["项目列表", "/projects"], ["需求池", "/requirements"], ["需求搜索", `/requirements?q=${encodeURIComponent("乙企业")}`], ["看板", "/board"], ["Bug 列表", "/bugs"], ["发版列表", "/releases"], ["进展总览", "/leadership"], ["文档首页", "/docs"], ["最近文档", "/docs/recent"], ["产品列表", "/products"], ["成员页", "/members"], ["组织页", "/orgs"], ["元数据接口", "/api/meta"], ["产品接口", "/api/products"], ["文档空间接口", "/api/docs/spaces"], ["回收站接口", "/api/lifecycle?tab=trash"]]) {
  const t = await (await req(p, { cookie: ma })).text();
  ok(`列表不含别的企业：${n}`, !/乙企业(机密|项目|产品|公共池)|sec-outsider/.test(t.replace(/q=[^"&]*/g, "").replace(/\\?"q\\?":\\?"乙企业\\?"/g, "")));
}
const asst = await js(await req("/api/assistant", { cookie: ma, method: "POST", body: { message: "按状态分组" } }));
ok("AI 助手不含别的企业", !SECRET.test(JSON.stringify(asst)) && /甲企业/.test(JSON.stringify(asst)), asst);
ok("AI 助手指定别的企业项目 404", (await req("/api/assistant", { cookie: ma, method: "POST", body: { message: "x", projectId: b.projB } })).status === 404);
ok("ref-search 不能搜别的企业空间", (await req(`/api/docs/ref-search?spaceId=${b.projB}&q=${encodeURIComponent("机密")}`, { cookie: ma })).status === 403);
ok("文档引用不能关联别的企业", (await req(`/api/title-gen/bulk`, { cookie: ma, method: "POST", body: { kind: "bug", ids: [b.bugB] } })).status === 200 && ((await js(await req(`/api/title-gen/bulk`, { cookie: ma, method: "POST", body: { kind: "bug", ids: [b.bugB] } }))).items || []).length === 0);
// 本企业正常（防止把隔离测成全都看不到）
ok("本企业项目可见", (await req(`/api/projects/${b.projA}`, { cookie: ma })).status === 200);
ok("本企业需求页可见", (await req(`/requirements/${b.reqA}`, { cookie: ma })).status === 200);
ok("本企业公共池可见", (await req(`/requirements/${b.poolA}`, { cookie: ma })).status === 200);
ok("工作台能看到本企业项目", (await (await req("/projects", { cookie: ma })).text()).includes("甲企业项目SEC"));
ok("乙企业成员看自己的项目", (await req(`/api/projects/${b.projB}`, { cookie: ob })).status === 200);
ok("乙企业成员看自己的需求", (await req(`/requirements/${b.reqB}`, { cookie: ob })).status === 200);
ok("乙企业成员看自己的 Bug", (await req(`/api/bugs/${b.bugB}`, { cookie: ob })).status === 200);
ok("乙企业成员读自己的附件", (await req(`/api/attachments/${b.attB}`, { cookie: ob })).status === 200);
ok("乙企业成员看自己的产品", (await req(`/api/products/${b.prodB}`, { cookie: ob })).status === 200);
ok("乙企业成员反过来看不到甲", (await req(`/api/projects/${b.projA}`, { cookie: ob })).status === 404);
// 企业内角色范围照旧：乙企业的普通成员不在项目里
ok("企业内普通成员看不到没参与的项目", (await req(`/api/projects/${b.projB}`, { cookie: m2 })).status === 404);
ok("企业内普通成员看得到本企业公共池", (await req(`/requirements/${b.poolB}`, { cookie: m2 })).status === 200);
// 没有企业的账号
ok("无企业账号看不到业务数据", !/甲企业|乙企业/.test(await (await req("/requirements", { cookie: ru })).text()));
ok("无企业账号不能建项目", (await req("/api/projects", { cookie: ru, method: "POST", body: { name: "x", systemName: "x", key: "SECX1" } })).status === 403);
// 新建归属
const npj = await js(await req("/api/projects", { cookie: ma, method: "POST", body: { name: "甲新建SEC", systemName: "甲", key: `SECN${Date.now() % 100000}` } }));
ok("管理者新建的项目归本企业", sql(`select enterpriseId from projects where id='${npj.id}'`) === "sec_ent_a", npj);
const npd = await js(await req("/api/products", { cookie: ma, method: "POST", body: { name: "甲新产品SEC", code: `SECP${Date.now() % 100000}` } }));
ok("管理者新建的产品归本企业", sql(`select enterpriseId from products where id='${npd.id}'`) === "sec_ent_a", npd);
ok("不能把别的企业的人加进项目", (await js(await req(`/api/projects/${b.projA}/members`, { cookie: ma, method: "POST", body: { userIds: [outId] } }))).added === 0);
ok("不能把项目挂到别的企业的产品", (await req(`/api/projects/${b.projA}`, { cookie: ma, method: "PATCH", body: { productId: b.prodB } })).status === 400);
ok("管理者不能改所属企业", (await req(`/api/projects/${b.projA}`, { cookie: ma, method: "PATCH", body: { enterpriseId: "sec_ent_b" } })).status === 403);
// 所属企业的选择和转移
const mj = await js(await req("/api/meta", { cookie: ma }));
ok("企业列表不给非系统管理员", Array.isArray(mj.enterprises) && mj.enterprises.length === 0);
const aj = await js(await req("/api/meta", { cookie: a.cookie }));
ok("企业列表给系统管理员", aj.enterprises.some((e) => e.id === "sec_ent_b"));
const ign = await js(await req("/api/projects", { cookie: ma, method: "POST", body: { name: "忽略企业SEC", systemName: "甲", key: `SECI${Date.now() % 100000}`, enterpriseId: "sec_ent_b" } }));
ok("非管理员传的企业被忽略", sql(`select enterpriseId from projects where id='${ign.id}'`) === "sec_ent_a", ign);
const ignP = await js(await req("/api/products", { cookie: ma, method: "POST", body: { name: "忽略企业产品SEC", code: `SECQ${Date.now() % 100000}`, enterpriseId: "sec_ent_b" } }));
ok("非管理员建产品传的企业被忽略", sql(`select enterpriseId from products where id='${ignP.id}'`) === "sec_ent_a", ignP);
const adp = await js(await req("/api/projects", { cookie: a.cookie, method: "POST", body: { name: "管理员指定SEC", systemName: "乙", key: `SECJ${Date.now() % 100000}`, enterpriseId: "sec_ent_b" } }));
ok("系统管理员指定企业生效", sql(`select enterpriseId from projects where id='${adp.id}'`) === "sec_ent_b", adp);
ok("系统管理员指定不存在的企业被拒", (await req("/api/projects", { cookie: a.cookie, method: "POST", body: { name: "x", systemName: "x", key: `SECK${Date.now() % 100000}`, enterpriseId: "nope" } })).status === 400);
ok("产品和企业不一致被拒", (await req("/api/projects", { cookie: a.cookie, method: "POST", body: { name: "x", systemName: "x", key: `SECL${Date.now() % 100000}`, enterpriseId: "sec_ent_a", productId: b.prodB } })).status === 400);
ok("管理者不能改产品的企业", (await req(`/api/products/${npd.id}`, { cookie: ma, method: "PATCH", body: { enterpriseId: "sec_ent_b" } })).status === 403);
// 转移项目：把挂了产品的乙企业项目转到甲
sql(`update requirements set productId='${b.prodB}' where id='${b.reqB}'`);
const mv = await js(await req(`/api/projects/${b.projB}`, { cookie: a.cookie, method: "PATCH", body: { enterpriseId: "sec_ent_a" } }));
ok("转移项目成功并解除产品", mv.ok === true && mv.detached === true, mv);
ok("转移后所属产品已清空", sql(`select productId is null from projects where id='${b.projB}'`) === "1");
ok("转移后需求的产品已清空", sql(`select productId is null from requirements where id='${b.reqB}'`) === "1");
ok("转移有审计", Number(sql(`select count(*) from activity_logs where entityType='project' and entityId='${b.projB}' and action='enterprise_moved'`)) === 1);
ok("甲企业现在看得到", (await req(`/requirements/${b.reqB}`, { cookie: ma })).status === 200 && (await req(`/api/bugs/${b.bugB}`, { cookie: ma })).status === 200);
ok("乙企业成员看不到了", (await req(`/requirements/${b.reqB}`, { cookie: ob })).status === 404);
ok("附件跟着走", (await req(`/api/attachments/${b.attB}`, { cookie: ma })).status === 200);
await req(`/api/projects/${b.projB}`, { cookie: a.cookie, method: "PATCH", body: { enterpriseId: "sec_ent_b" } });
// 转移产品：项目一起走
sql(`update projects set productId='${b.prodB}' where id='${b.projB}'`);
ok("转移产品成功", (await req(`/api/products/${b.prodB}`, { cookie: a.cookie, method: "PATCH", body: { enterpriseId: "sec_ent_a" } })).status === 200);
ok("产品下的项目一起转", sql(`select enterpriseId from projects where id='${b.projB}'`) === "sec_ent_a");
await req(`/api/products/${b.prodB}`, { cookie: a.cookie, method: "PATCH", body: { enterpriseId: "sec_ent_b" } });
// 系统管理员不受限
ok("系统管理员看得到两边", (await req(`/api/projects/${b.projB}`, { cookie: a.cookie })).status === 200 && (await req(`/api/projects/${b.projA}`, { cookie: a.cookie })).status === 200);
ok("系统管理员看得到全部公共池", (await req(`/requirements/${b.poolB}`, { cookie: a.cookie })).status === 200);

// 11 ITR / 飞书
ok("成员不能调 ITR 同步", (await req("/api/sync/itr", { cookie: m.cookie, method: "POST", body: { filePath: "/etc/passwd" } })).status === 403);
ok("成员读不到 ITR 配置", (await req("/api/sync/itr", { cookie: m.cookie })).status === 403);
const fpt = await (await req("/api/sync/itr", { cookie: a.cookie, method: "POST", body: { mode: "file", filePath: "/etc/hosts", dryRun: true } })).text();
ok("filePath 被忽略", !fpt.includes("/etc/hosts") && !/ENOENT|Unexpected token/.test(fpt), fpt);
ok("访客不能读飞书表格", (await req("/api/feishu-tables/inspect", { cookie: g.cookie, method: "POST", body: { url: "https://x.feishu.cn/sheets/abc" } })).status === 403);

// 12 开放重定向
for (const n of ["/\\evil.com", "//evil.com", "/%09/evil.com", "https://evil.com"]) {
  const l = (await req(`/api/auth/logout?next=${encodeURIComponent(n)}`)).headers.get("location") || "";
  ok(`logout next ${n}`, new URL(l, B).host === new URL(B).host, l);
}
const fe = await req(`/api/auth/feishu?from=${encodeURIComponent("/\\evil.com")}`);
ok("飞书入口跳转正常", fe.status >= 300 && fe.status < 400);
ok("GET logout 不能把有效会话登出", (await req("/api/auth/logout", { cookie: a.cookie })).status >= 300 && (await req("/api/meta", { cookie: a.cookie })).status === 200);

// 13 强制改密
const f = await login("force");
ok("强制改密账号可登录", f.status === 200 && (await js(f.raw)).user?.mustChangePassword === true);
ok("接口被拦 401", (await req("/api/meta", { cookie: f.cookie })).status === 401);
ok("写接口被拦 401", (await req("/api/requirements", { cookie: f.cookie, method: "POST", body: { title: "x" } })).status === 401);
ok("/x.png 后缀绕不过", (await req("/api/requirements/x.png", { cookie: f.cookie, method: "PATCH", body: { title: "x" } })).status === 401);
const hp = await req("/requirements", { cookie: f.cookie });
const hpBody = await hp.text();
ok("页面跳改密页", (hp.status >= 300 && hp.status < 400 && hp.headers.get("location")?.includes("/settings?force=1")) || hpBody.includes("/settings?force=1"), `${hp.status} ${hp.headers.get("location")}`);
// Next 16 对缺 _rsc 参数的 RSC 请求先 307 到带校验参数的地址，跟随后才是真实响应
let rr = await req("/requirements", { cookie: f.cookie, headers: { RSC: "1", "Next-Url": "/" } });
for (let i = 0; i < 3 && rr.status >= 300 && rr.status < 400; i++) {
  const l = rr.headers.get("location");
  if (l.includes("/settings?force=1")) { rr = new Response("/settings?force=1"); break; }
  rr = await req(l, { cookie: f.cookie, headers: { RSC: "1", "Next-Url": "/" } });
}
const rs = await rr.text();
ok("前端路由切换被拦（返回跳转，不含页面数据）", rs.includes("/settings?force=1") && !rs.includes(fx.req.title), rs.slice(0, 120));
ok("伪造 x-pm-path 无效", (await req("/api/meta", { cookie: f.cookie, headers: { "x-pm-path": "/settings" } })).status === 401);
ok("改密页可打开", (await req("/settings?force=1", { cookie: f.cookie })).status === 200);
const fc = await req("/api/auth/change-password", { cookie: f.cookie, method: "POST", body: { currentPassword: fx.creds.force, newPassword: `Zz8${fx.creds.force.slice(3)}y` } });
ok("改密后放行", fc.status === 200 && (await req("/api/meta", { cookie: cookieOf(fc) })).status === 200);

// 14 响应头
const lg = await req("/login");
const csp = lg.headers.get("content-security-policy") || "";
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
const html = await lg.text();
const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((x) => x[0]);
ok("页面 CSP 带 nonce、无 script unsafe-inline", !!nonce && !/script-src[^;]*unsafe-inline/.test(csp) && !/unsafe-eval/.test(csp), csp);
ok("所有 script 都带 nonce", scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), scripts.filter((s) => !s.includes("nonce")).slice(0, 2));
const n2 = /'nonce-([^']+)'/.exec((await req("/login")).headers.get("content-security-policy") || "")?.[1];
ok("nonce 每次不同", n2 && n2 !== nonce);
ok("frame-ancestors none", csp.includes("frame-ancestors 'none'"));
for (const [k, v] of [["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"], ["referrer-policy", "strict-origin-when-cross-origin"]]) ok(`头 ${k}`, lg.headers.get(k) === v, lg.headers.get(k));
ok("Permissions-Policy", (lg.headers.get("permissions-policy") || "").includes("camera=()"));
ok("生产 HSTS", (lg.headers.get("strict-transport-security") || "").includes("max-age"));
ok("无 X-Powered-By", !lg.headers.get("x-powered-by"));
ok("接口 CSP 最严", ((await req("/api/meta", { cookie: a.cookie })).headers.get("content-security-policy") || "").includes("default-src 'none'"));
ok("附件 CSP sandbox", ((await req(`/api/attachments/${att}`, { cookie: a.cookie })).headers.get("content-security-policy") || "").includes("sandbox"));

// 15 爬页面和 GET 接口，查密码哈希和 500
const pages = ["/", "/projects", "/requirements", "/my/requirements", "/my/bugs", "/bugs", "/board", "/releases", "/leadership", "/members", "/orgs", "/permissions", "/positions", "/products", "/docs", "/docs/recent", "/settings", "/system/general", "/system/bin", "/system/feishu-tables", "/system/stages", "/system/feishu", "/system/ai-image", `/projects/${P}`, `/projects/${P}/members`, `/projects/${P}/board`, `/projects/${P}/requirements`, `/projects/${P}/bugs`, `/projects/${P}/releases`, `/projects/${P}/plans`, `/requirements/${R}`, `/releases/${rel.id}`, `/docs/${sp}`, `/docs/${sp}/pages/${pg.id}`, `/docs/${sp}/pages/${pg.id}/edit`, `/docs/${sp}/pages/${pg.id}/history`, `/products/${fx.prod.id}`,
  "/api/meta", "/api/users", "/api/orgs", "/api/roles", "/api/positions", "/api/permissions", "/api/products", "/api/products/nav", "/api/docs/spaces", `/api/projects/${P}/members`, `/api/requirements/${R}/comments`, "/api/feishu-tables", "/api/lifecycle", "/api/system/settings", "/api/me/bot", "/api/me/schedules"];
let leaks = [], errors = [];
for (const p of pages) {
  const r = await req(p, { cookie: a.cookie });
  const t = await r.text();
  if (/\$2[aby]\$\d\d\$|passwordHash|tokenHash/.test(t)) leaks.push(p);
  if (r.status >= 500 || r.status === 404) errors.push(`${p}:${r.status}`);
}
ok(`${pages.length} 个页面 / 接口无密码哈希`, leaks.length === 0, leaks);
ok("页面和接口无 404 / 500", errors.length === 0, errors);
ok("飞书连接不下发 token", !/"token":"/.test(await (await req("/api/feishu-tables", { cookie: a.cookie })).text()));

// T15 Weavi Space 系统后台与企业超管：只有系统超管能管企业；企业超管唯一，别的管理者动不了它
{
  const sa = (await login("admin2")).cookie, m1 = (await login("manager")).cookie;
  ok("管理者读企业列表 403", (await req("/api/nova/enterprises", { cookie: m1 })).status === 403);
  ok("管理者改企业超管 403", (await req("/api/nova/enterprises/sec_ent_a", { cookie: m1, method: "PUT", body: { userId: uid("manager") } })).status === 403 && sql("select coalesce(adminUserId, '') from organizations where id='sec_ent_a'") === "");
  ok("管理者打不开 Weavi Space 后台页面", (await req("/system/enterprises", { cookie: m1 })).status === 404 && (await req("/system/admins", { cookie: m1 })).status === 404);
  ok("管理者读系统超管列表 403", (await req("/api/nova/admins", { cookie: m1 })).status === 403);
  const code = `sec-t15-${Date.now() % 100000}`;
  ok("系统超管给企业设编码", (await req("/api/nova/enterprises/sec_ent_a", { cookie: sa, method: "PATCH", body: { code } })).status === 200);
  ok("企业编码不能重复", (await req("/api/nova/enterprises/sec_ent_b", { cookie: sa, method: "PATCH", body: { code } })).status === 400);
  ok("不能指定别的企业的人为超管", (await req("/api/nova/enterprises/sec_ent_a", { cookie: sa, method: "PUT", body: { userId: uid("outsider") } })).status === 400);
  ok("系统超管指定企业超管", (await req("/api/nova/enterprises/sec_ent_a", { cookie: sa, method: "PUT", body: { userId: uid("manager2") } })).status === 200 && sql("select adminUserId from organizations where id='sec_ent_a'") === uid("manager2"));
  ok("同一账号不能兼任两个企业超管", (await req("/api/nova/enterprises/sec_ent_b", { cookie: sa, method: "PUT", body: { userId: uid("manager2") } })).status === 400);
  ok("别的管理者改不了企业超管", (await req("/api/users", { cookie: m1, method: "PATCH", body: { id: uid("manager2"), name: "x" } })).status === 403);
  ok("别的管理者重置不了企业超管密码", (await req("/api/users", { cookie: m1, method: "PATCH", body: { id: uid("manager2"), resetPassword: true } })).status === 403);
  const boss = (await login("manager2")).cookie;
  ok("企业超管能改本企业的管理者", (await req("/api/users", { cookie: boss, method: "PATCH", body: { id: uid("manager"), name: "sec-manager" } })).status === 200);
  ok("企业超管能授予管理者角色", (await req("/api/users", { cookie: boss, method: "PATCH", body: { id: uid("role"), globalRole: "manager" } })).status === 200);
  ok("企业超管不能授予系统管理员", (await req("/api/users", { cookie: boss, method: "PATCH", body: { id: uid("role"), globalRole: "admin" } })).status === 403);
  ok("企业超管管不到别的企业", (await req("/api/users", { cookie: boss, method: "PATCH", body: { id: uid("outsider"), name: "x" } })).status === 403);
  ok("系统超管停用企业超管前要先换人", (await req("/api/users", { cookie: sa, method: "PATCH", body: { id: uid("manager2"), isActive: false } })).status === 400);
  ok("企业超管不能设为系统超管", (await req("/api/nova/admins", { cookie: sa, method: "POST", body: { userId: uid("manager2") } })).status === 400);
  ok("系统超管不能取消自己", (await req(`/api/nova/admins?id=${uid("admin2")}`, { cookie: sa, method: "DELETE" })).status === 400);
  const pages = await Promise.all(["/system/enterprises", "/system/admins"].map(async (p) => (await req(p, { cookie: sa })).status));
  ok("系统超管能打开 Weavi Space 后台两页", pages.every((st) => st === 200), pages);
  const list = await js(await req("/api/nova/enterprises", { cookie: sa }));
  ok("企业列表不下发密码哈希", !JSON.stringify(list).includes("passwordHash") && (list.enterprises || []).some((e) => e.id === "sec_ent_a" && e.admin?.id === uid("manager2")));
}

// T17 批 2：登录管理、邀请链接、重置链接、验证码、手机号脱敏
{
  const sa = (await login("admin2")).cookie, m1 = (await login("manager")).cookie, boss = (await login("manager2")).cookie;
  const opt = await req("/api/auth/login-options");
  const optText = await opt.text();
  ok("登录方式接口公开且不含任何配置", opt.status === 200 && optText.includes('"password":true') && !/secret|appId|corpId|clientId|host/i.test(optText));
  ok("未知企业编码提示", (await js(await req("/api/auth/login-options?org=no-such-ent"))).unknownOrg === true);
  ok("管理者不能看登录管理", (await req("/api/system/login", { cookie: m1 })).status === 403);
  const entView = await js(await req("/api/system/login", { cookie: boss }));
  ok("企业超管只看到本企业范围", Array.isArray(entView.scopes) && entView.scopes.length === 1 && entView.scopes[0].id === "sec_ent_a");
  ok("企业超管不能改系统级", (await req("/api/system/login", { cookie: boss, method: "PUT", body: { scope: "", kind: "feishu", enabled: false } })).status === 403);
  ok("企业超管不能改别的企业", (await req("/api/system/login", { cookie: boss, method: "PUT", body: { scope: "sec_ent_b", kind: "wecom", enabled: false } })).status === 403);
  ok("配置不完整不能开启", (await req("/api/system/login", { cookie: boss, method: "PUT", body: { scope: "sec_ent_a", kind: "wecom", enabled: true, config: { corpId: "ww1" } } })).status === 400);
  const saved = await req("/api/system/login", { cookie: boss, method: "PUT", body: { scope: "sec_ent_a", kind: "dingtalk", config: { clientId: "ding-ck", clientSecret: "ding-secret-SEC" } } });
  const savedText = await saved.text();
  ok("保存配置后不回传密钥明文", saved.status === 200 && !savedText.includes("ding-secret-SEC") && !sql("select coalesce(configEnc, '') from login_providers where scope='sec_ent_a' and kind='dingtalk'").includes("ding-secret-SEC"));
  ok("没开通的验证码登录被拒", (await req("/api/auth/code/send", { method: "POST", body: { channel: "email", target: "sec-manager@verify.test" } })).status === 400);
  ok("管理员不能设初始密码", (await req("/api/users", { cookie: sa, method: "POST", body: { name: "x", account: "sec-pw@verify.test", password: "Abcdefgh1234", orgId: "sec_dept_a" } })).status === 400);
  ok("管理员不能直接改密码", (await req("/api/users", { cookie: sa, method: "PATCH", body: { id: uid("target"), password: "Abcdefgh1234" } })).status === 400);
  // 邀请：生成链接 → 核对邮箱 → 免密登录 → 首次设置密码
  const inv = await js(await req("/api/users", { cookie: sa, method: "POST", body: { name: "邀请测试", account: "sec-inv@verify.test", phone: "13800138000", orgId: "sec_dept_a" } }));
  const token = (inv.inviteLink || "").split("/invite/")[1] || "";
  ok("邀请返回链接、不返回密码", token.length > 30 && !JSON.stringify(inv).includes("temporaryPassword"));
  ok("被邀请账号库里没有密码，手机号只存密文", sql("select passwordHash is null from users where email='sec-inv@verify.test'") === "1" && !sql("select coalesce(phoneEnc, '') from users where email='sec-inv@verify.test'").includes("13800138000"));
  const list = await (await req("/api/users", { cookie: sa })).text();
  ok("账号列表只给脱敏手机号", list.includes("138****8000") && !list.includes("13800138000"));
  ok("没设密码的账号不能用密码登录", (await req("/api/auth/login", { method: "POST", body: { account: "sec-inv@verify.test", password: "Abcdefgh1234" } })).status === 401);
  const page = await req(`/invite/${token}`);
  const pageHtml = await page.text();
  ok("邀请页公开可打开，只显示脱敏邮箱", page.status === 200 && pageHtml.includes("s***@verify.test") && !pageHtml.includes("sec-inv@verify.test"));
  ok("邮箱不一致不能用邀请登录", (await req("/api/auth/invite/accept", { method: "POST", body: { token, account: "sec-manager@verify.test" } })).status === 400);
  const acc = await req("/api/auth/invite/accept", { method: "POST", body: { token, account: "SEC-INV@verify.test" } });
  const ic = cookieOf(acc);
  ok("核对邮箱后免密登录", acc.status === 200 && Boolean(ic));
  ok("邀请链接只能用一次", (await req("/api/auth/invite/accept", { method: "POST", body: { token, account: "sec-inv@verify.test" } })).status === 410);
  const home = await req("/", { cookie: ic });
  const homeBody = await home.text();
  ok("首次登录先去设置密码", (home.status >= 300 && home.status < 400 && (home.headers.get("location") || "").includes("/settings?force=1")) || homeBody.includes("/settings?force=1"), `${home.status} ${home.headers.get("location")}`);
  const set1 = await req("/api/auth/change-password", { cookie: ic, method: "POST", body: { newPassword: "Inv1te-Passw0rd" } });
  ok("没有密码时不用填当前密码", set1.status === 200);
  ok("设好的密码能登录", (await req("/api/auth/login", { method: "POST", body: { account: "sec-inv@verify.test", password: "Inv1te-Passw0rd" } })).status === 200);
  const nopw = await req("/api/auth/change-password", { cookie: cookieOf(set1) || ic, method: "POST", body: { newPassword: "Another-Passw0rd" } });
  ok("已有密码时必须填当前密码", nopw.status === 400);
  // 重置：旧密码作废、会话下线 → 重置链接 → 再设密码
  const invId = sql("select id from users where email='sec-inv@verify.test'");
  const live = (await login("inv", "Inv1te-Passw0rd")).cookie || cookieOf(await req("/api/auth/login", { method: "POST", body: { account: "sec-inv@verify.test", password: "Inv1te-Passw0rd" } }));
  ok("别的管理者不能给别的企业的人重置", (await req("/api/users", { cookie: m1, method: "PATCH", body: { id: uid("outsider"), resetPassword: true } })).status === 403);
  const rs = await js(await req("/api/users", { cookie: sa, method: "PATCH", body: { id: invId, resetPassword: true } }));
  const rtoken = (rs.resetLink || "").split("/invite/")[1] || "";
  ok("重置返回链接", rtoken.length > 30);
  ok("重置后旧密码失效", (await req("/api/auth/login", { method: "POST", body: { account: "sec-inv@verify.test", password: "Inv1te-Passw0rd" } })).status === 401);
  ok("重置后原会话下线", (await req("/api/meta", { cookie: live })).status === 401);
  for (let i = 0; i < 5; i++) await req("/api/auth/invite/accept", { method: "POST", body: { token: rtoken, account: `wrong${i}@verify.test` } });
  ok("重置链接试错 5 次后作废", (await req("/api/auth/invite/accept", { method: "POST", body: { token: rtoken, account: "sec-inv@verify.test" } })).status === 410);
  const rs2 = await js(await req("/api/users", { cookie: sa, method: "PATCH", body: { id: invId, resetPassword: true } }));
  const r2 = await req("/api/auth/invite/accept", { method: "POST", body: { token: (rs2.resetLink || "").split("/invite/")[1], account: "13800138000" } });
  ok("可以用绑定的手机号核对重置链接", r2.status === 200);
  ok("登录日志不记录手机号明文", !sql("select string_agg(coalesce(toValue, '') || coalesce(message, ''), ' ') from activity_logs").includes("13800138000"));
}

// T17 批 3：模型管理、定额、AI 对话（本地假模型服务，OpenAI 兼容）、AI 生图按企业
{
  const { createServer } = await import("http");
  let reply = "好的。";
  const fake = createServer((rq, rs) => {
    let raw = "";
    rq.on("data", (c) => (raw += c));
    rq.on("end", () => {
      rs.setHeader("content-type", "application/json");
      if (rq.headers.authorization !== "Bearer sk-fake-SEC") return rs.writeHead(401).end(JSON.stringify({ error: { message: "bad key" } }));
      if (rq.url.endsWith("/models")) return rs.end(JSON.stringify({ data: [{ id: "fake-chat" }, { id: "fake-mini" }] }));
      rs.end(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 60, completion_tokens: 50 } }));
    });
  });
  await new Promise((r) => fake.listen(3199, "127.0.0.1", r));
  const sa = (await login("admin2")).cookie, boss = (await login("manager2")).cookie, m1 = (await login("manager")).cookie, ob = (await login("outsider")).cookie;
  const base = "http://127.0.0.1:3199/v1";
  ok("Key 错误时拉不到模型，不保存", (await req("/api/ai/credentials", { cookie: m1, method: "POST", body: { provider: "openai_compat", baseUrl: base, apiKey: "sk-wrong" } })).status === 400);
  const mine = await js(await req("/api/ai/credentials", { cookie: m1, method: "POST", body: { provider: "openai_compat", name: "我的假模型", baseUrl: base, apiKey: "sk-fake-SEC" } }));
  ok("个人模型保存并拉到模型列表", (mine.credential?.models || []).includes("fake-chat") && !JSON.stringify(mine).includes("sk-fake-SEC"));
  ok("库里 Key 是密文", !sql("select string_agg(apiKeyEnc, '') from ai_credentials").includes("sk-fake-SEC"));
  ok("别人看不到、改不了我的模型", (await req(`/api/ai/credentials/${mine.credential?.id}`, { cookie: ob, method: "PATCH", body: { name: "x" } })).status === 404);
  ok("普通管理者不能配企业模型", (await req("/api/ai/credentials", { cookie: m1, method: "POST", body: { ownerType: "enterprise", enterpriseId: "sec_ent_a", provider: "openai_compat", baseUrl: base, apiKey: "sk-fake-SEC" } })).status === 403);
  const ent = await js(await req("/api/ai/credentials", { cookie: boss, method: "POST", body: { ownerType: "enterprise", enterpriseId: "sec_ent_a", provider: "openai_compat", name: "企业假模型", baseUrl: base, apiKey: "sk-fake-SEC" } }));
  ok("企业超管配置企业模型", Boolean(ent.credential?.id));
  ok("企业超管不能给别的企业成员设定额", (await req("/api/ai/quotas", { cookie: boss, method: "PUT", body: { enterpriseId: "sec_ent_a", userId: uid("outsider"), period: "day", tokenLimit: 100 } })).status === 400);
  ok("企业超管给成员设定额", (await req("/api/ai/quotas", { cookie: boss, method: "PUT", body: { enterpriseId: "sec_ent_a", userId: uid("manager"), period: "day", tokenLimit: 100 } })).status === 200);
  const models = await js(await req("/api/ai/models", { cookie: m1 }));
  ok("企业模型排在个人模型前面", models.options?.[0]?.source === "enterprise" && models.options?.some((o) => o.source === "personal"));
  ok("乙企业成员看不到甲企业的模型", !(await js(await req("/api/ai/models", { cookie: ob }))).options?.some((o) => o.credentialId === ent.credential?.id));
  // 工作区范围：AI 提议新建需求 → 确认后用自己的权限执行
  const projA = b.projA;
  reply = `我来新建。\n\`\`\`action\n{"type":"create_requirement","projectId":"${projA}","title":"AI 新建的需求SEC"}\n\`\`\``;
  const sent = await js(await req("/api/ai/conversations", { cookie: m1, method: "POST", body: { message: "建个需求", scope: "workspace", credentialId: ent.credential?.id, model: "fake-chat" } }));
  ok("AI 回复带待确认操作，没有直接执行", sent.message?.actionStatus === "pending" && sql("select count(*) from requirements where title='AI 新建的需求SEC'") === "0");
  ok("别人不能确认我的操作", (await req(`/api/ai/actions/${sent.message?.id}`, { cookie: ob, method: "POST", body: { confirm: true } })).status === 404);
  const done = await req(`/api/ai/actions/${sent.message?.id}`, { cookie: m1, method: "POST", body: { confirm: true } });
  ok("确认后执行，数据写入", done.status === 200 && sql("select count(*) from requirements where title='AI 新建的需求SEC'") === "1");
  ok("同一操作不能执行两次", (await req(`/api/ai/actions/${sent.message?.id}`, { cookie: m1, method: "POST", body: { confirm: true } })).status === 409);
  ok("用量计入企业定额", Number(sql(`select coalesce(sum(inputTokens + outputTokens), 0) from ai_usage where userId='${uid("manager")}' and billedTo='enterprise'`)) === 110);
  const over = await req("/api/ai/conversations", { cookie: m1, method: "POST", body: { message: "再问一次", scope: "none", credentialId: ent.credential?.id, model: "fake-chat" } });
  ok("定额用完后企业模型不能用（token 不足）", over.status === 402 && (await over.text()).includes("token 不足"));
  ok("定额用完时企业模型显示不可选", (await js(await req("/api/ai/models", { cookie: m1 }))).options?.find((o) => o.source === "enterprise")?.disabled === true);
  reply = `改一下。\n\`\`\`action\n{"type":"create_requirement","projectId":"${b.projB}","title":"越权需求SEC"}\n\`\`\``;
  const evil = await js(await req("/api/ai/conversations", { cookie: m1, method: "POST", body: { message: "往乙企业建", scope: "none", credentialId: mine.credential?.id, model: "fake-chat" } }));
  const ev = await req(`/api/ai/actions/${evil.message?.id}`, { cookie: m1, method: "POST", body: { confirm: true } });
  ok("AI 提议越权操作，执行时仍被权限挡住", ev.status === 404 && sql("select count(*) from requirements where title='越权需求SEC'") === "0");
  ok("别人读不到我的对话", (await req(`/api/ai/conversations/${sent.conversationId}`, { cookie: ob })).status === 404);
  ok("不能选看不到的项目做范围", (await req("/api/ai/conversations", { cookie: m1, method: "POST", body: { message: "x", scope: "project", projectId: b.projB, credentialId: mine.credential?.id, model: "fake-chat" } })).status === 404);
  // AI 生图：按企业配置，普通成员 / 管理者不能配，企业超管只能配本企业
  ok("管理者不能配 AI 生图", (await req("/api/system/ai-image", { cookie: m1 })).status === 403);
  ok("企业超管不能配系统级 AI 生图", (await req("/api/system/ai-image", { cookie: boss, method: "PUT", body: { scope: "", baseUrl: "https://ark.example.com/api/v3", model: "m", apiKey: "k", price: 0.2 } })).status === 403);
  const img = await req("/api/system/ai-image", { cookie: boss, method: "PUT", body: { scope: "sec_ent_a", baseUrl: "https://ark.example.com/api/v3", model: "seedream", apiKey: "img-key-SEC", price: 0.25 } });
  ok("企业超管配本企业 AI 生图，Key 不回传", img.status === 200 && !(await img.text()).includes("img-key-SEC"));
  ok("乙企业项目看不到甲企业的生图配置", (await js(await req(`/api/system/ai-image?project=${b.projB}`, { cookie: ob }))).configured === false);
  ok("甲企业项目可用生图", (await js(await req(`/api/system/ai-image?project=${b.projA}`, { cookie: m1 }))).configured === true);
  await new Promise((r) => fake.close(r));
}

// T17 批 4：云表格首次必须先拉取；云文档权限与隔离
{
  const sa = (await login("admin2")).cookie, m1 = (await login("manager")).cookie, ob = (await login("outsider")).cookie, gu = (await login("guest")).cookie;
  sql(`insert into feishu_table_links (id, name, kind, url, token, tableId, projectId, createdById, updatedAt) values ('sec_ftl_1', '首拉测试', 'sheet', 'https://x.feishu.cn/sheets/abc', 'abc', 's1', '${b.projA}', '${uid("manager")}', now())`);
  const push = await req("/api/feishu-tables/sec_ftl_1/sync", { cookie: m1, method: "POST", body: { direction: "push" } });
  ok("没拉取过的连接不能回写", push.status === 400 && (await push.text()).includes("先「从飞书拉取」"));
  ok("云文档：链接不是飞书的被拒", (await req("/api/cloud-docs", { cookie: m1, method: "POST", body: { url: "https://evil.example/docx/abc", spaceId: b.projA } })).status === 400);
  ok("云文档：不能导入到别的企业的空间", (await req("/api/cloud-docs", { cookie: m1, method: "POST", body: { url: "https://x.feishu.cn/docx/abc", spaceId: b.projB } })).status === 404);
  ok("云文档：没有文档编辑权限不能添加", [403, 404].includes((await req("/api/cloud-docs", { cookie: gu, method: "POST", body: { url: "https://x.feishu.cn/docx/abc", spaceId: b.projA } })).status));
  const cd = await js(await req("/api/cloud-docs", { cookie: m1, method: "POST", body: { name: "甲企业文档SEC", url: "https://x.feishu.cn/docx/abc", spaceId: b.projA } }));
  ok("云文档：本企业空间可以添加", Boolean(cd.id));
  ok("云文档：别的企业看不到这个连接", !(await (await req("/api/cloud-docs", { cookie: ob })).text()).includes("甲企业文档SEC"));
  ok("云文档：别的企业不能同步、删除", (await req(`/api/cloud-docs/${cd.id}/sync`, { cookie: ob, method: "POST" })).status === 404 && (await req(`/api/cloud-docs/${cd.id}`, { cookie: ob, method: "DELETE" })).status === 404);
  ok("云表格页能打开两个标签", (await req("/system/feishu-tables", { cookie: sa })).status === 200 && (await req("/system/feishu-tables?tab=docs", { cookie: sa })).status === 200);
}

// T17 批 5：站内通知、项目周报、个人模板、工作台版式
{
  const m1 = (await login("manager")).cookie, ob = (await login("outsider")).cookie, mb = (await login("member")).cookie, sa = (await login("admin2")).cookie;
  // 通知：甲企业管理者给 target 建一个 Bug → target 收到；乙企业的人读不到、标不了
  sql(`insert into notifications (id, userId, kind, title, createdAt) values ('sec_ntf_1', '${uid("member2")}', 'bug_assigned', '甲企业通知SEC', now())`);
  const tc = (await login("member2")).cookie;
  const mine = await js(await req("/api/notifications", { cookie: tc }));
  ok("自己能看到自己的通知和未读数", (mine.items || []).some((n) => n.id === "sec_ntf_1") && mine.unread >= 1);
  ok("别人看不到我的通知", !(await (await req("/api/notifications", { cookie: ob })).text()).includes("甲企业通知SEC"));
  ok("别人标不了我的通知", (await js(await req("/api/notifications", { cookie: ob, method: "POST", body: { ids: ["sec_ntf_1"] } }))).count === 0);
  ok("标为已读", (await js(await req("/api/notifications", { cookie: tc, method: "POST", body: { ids: ["sec_ntf_1"] } }))).count === 1);
  ok("消息通知页能打开", (await req("/notifications", { cookie: tc })).status === 200);
  // 周报
  ok("别的企业的项目不能写周报", (await req(`/api/projects/${b.projA}/reports`, { cookie: ob, method: "POST", body: { done: "x" } })).status === 404);
  ok("别的企业的项目不能起草周报", (await req(`/api/projects/${b.projA}/reports/draft`, { cookie: ob })).status === 404);
  const rp = await req(`/api/projects/${b.projA}/reports`, { cookie: sa, method: "POST", body: { done: "完成登录", next: "做看板", risks: "", progress: 40 } });
  ok("能编辑项目的人写周报", rp.status === 200 && sql(`select count(*) from project_reports where projectId='${b.projA}'`) === "1");
  ok("周报进度不合法被拒", (await req(`/api/projects/${b.projA}/reports`, { cookie: sa, method: "POST", body: { progress: "abc" } })).status === 400);
  ok("按本周数据起草", typeof (await js(await req(`/api/projects/${b.projA}/reports/draft`, { cookie: sa }))).done === "string");
  ok("定时发送参数不合法被拒", (await req(`/api/projects/${b.projA}/report-schedule`, { cookie: sa, method: "PUT", body: { enabled: true, weekday: 9, hour: 30 } })).status === 400);
  ok("别的企业不能改定时发送", (await req(`/api/projects/${b.projA}/report-schedule`, { cookie: ob, method: "PUT", body: { enabled: true, weekday: 5, hour: 17 } })).status === 404);
  ok("设置定时发送", (await req(`/api/projects/${b.projA}/report-schedule`, { cookie: sa, method: "PUT", body: { enabled: true, weekday: 5, hour: 17 } })).status === 200);
  // 个人模板
  ok("模板不能挂到看不到的项目", (await req("/api/templates", { cookie: ob, method: "POST", body: { kind: "requirement", name: "x", projectId: b.projA, data: {} } })).status === 404);
  const tp = await js(await req("/api/templates", { cookie: m1, method: "POST", body: { kind: "requirement", name: "甲模板SEC", projectId: b.projA, data: { priority: "p1", descriptionHtml: "<p>背景</p><script>alert(1)</script>", evil: "x" } } }));
  ok("保存模板", Boolean(tp.id));
  const tl = await (await req(`/api/templates?kind=requirement&projectId=${b.projA}`, { cookie: m1 })).text();
  ok("模板内容经过清洗，未知字段丢弃", tl.includes("甲模板SEC") && !tl.includes("<script>") && !tl.includes('"evil"'));
  ok("别人看不到我的模板", !(await (await req(`/api/templates?kind=requirement`, { cookie: mb })).text()).includes("甲模板SEC"));
  ok("别人删不了我的模板", (await req(`/api/templates/${tp.id}`, { cookie: mb, method: "DELETE" })).status === 404);
  // 工作台各版式能打开
  sql(`update users set position='business' where email='sec-member@verify.test'`);
  sql(`update users set position='product' where email='sec-member2@verify.test'`);
  const pages = await Promise.all([sa, m1, mb, tc].map(async (c) => (await req("/", { cookie: c })).status));
  ok("管理者 / 业务 / 产品版工作台都能打开", pages.every((st) => st === 200), pages);
  ok("业务版工作台显示业务版", /业务(<!-- -->)?版/.test(await (await req("/", { cookie: mb })).text()));
}

// T17 批 6：MCP 服务、个人令牌、个人能力
{
  const { createServer } = await import("http");
  const fake = createServer((rq, rs) => {
    rq.resume();
    rq.on("end", () => {
      rs.setHeader("content-type", "application/json");
      if (rq.url.endsWith("/models")) return rs.end(JSON.stringify({ data: [{ id: "fake-chat" }] }));
      rs.end(JSON.stringify({ choices: [{ message: { content: "# PRD\n\n需求分析结果SEC" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    });
  });
  await new Promise((r) => fake.listen(3199, "127.0.0.1", r));
  const m1 = (await login("manager")).cookie, ob = (await login("outsider")).cookie;
  const mkTok = async (cookie, scopes) => (await js(await req("/api/me/tokens", { cookie, method: "POST", body: { name: "e2e", scopes, days: 30 } }))).token;
  const full = await mkTok(m1, ["projects.read", "requirements.read", "bugs.read", "requirements.create", "requirements.edit", "board.move"]);
  const ro = await mkTok(m1, ["requirements.read"]);
  ok("创建个人令牌，明文只返回一次", typeof full === "string" && full.startsWith("nc_pat_") && !(await (await req("/api/me/tokens", { cookie: m1 })).text()).includes(full));
  ok("令牌权限不能超过账号（访客要写权限被拒）", (await req("/api/me/tokens", { cookie: (await login("guest")).cookie, method: "POST", body: { name: "x", scopes: ["requirements.create"] } })).status === 400);
  const mcp = (token, method, params, idn = 1) => req("/api/mcp", { method: "POST", headers: { Authorization: token ? `Bearer ${token}` : undefined, Origin: undefined }, body: { jsonrpc: "2.0", id: idn, method, params } });
  ok("没有令牌不能用 MCP", [401, 429].includes((await mcp("", "initialize", {})).status));
  const init = await js(await mcp(full, "initialize", { protocolVersion: "2025-06-18" }));
  ok("MCP 握手", init.result?.serverInfo?.name === "weavi-space");
  const tl = await js(await mcp(full, "tools/list", {}));
  ok("MCP 列出工具（含个人能力）", (tl.result?.tools || []).some((t) => t.name === "create_requirement") && (tl.result?.tools || []).some((t) => t.name === "run_skill"));
  const call = async (token, name, args) => (await js(await mcp(token, "tools/call", { name, arguments: args }))).result;
  const lr = await call(full, "list_requirements", { pageSize: 100 });
  ok("MCP 只查到本企业数据", !lr.isError && lr.content[0].text.includes("甲企业需求SEC") && !lr.content[0].text.includes("乙企业机密需求SEC"));
  ok("MCP 读别的企业的需求按不存在处理", (await call(full, "get_requirement", { id: b.reqB })).isError === true);
  ok("MCP 不能往别的企业项目建需求", (await call(full, "create_requirement", { title: "MCP 越权SEC", projectId: b.projB })).isError === true && sql("select count(*) from requirements where title='MCP 越权SEC'") === "0");
  ok("只读令牌不能新建", (await call(ro, "create_requirement", { title: "只读SEC", projectId: b.projA })).isError === true && sql("select count(*) from requirements where title='只读SEC'") === "0");
  const cr = await call(full, "create_requirement", { title: "MCP 新建SEC", projectId: b.projA });
  ok("MCP 按本人权限新建需求", !cr.isError && sql("select count(*) from requirements where title='MCP 新建SEC'") === "1");
  // 个人能力
  const cred = await js(await req("/api/ai/credentials", { cookie: m1, method: "POST", body: { provider: "openai_compat", name: "skill 模型", baseUrl: "http://127.0.0.1:3199/v1", apiKey: "sk-skill" } }));
  const run = await js(await req("/api/skills/run", { cookie: m1, method: "POST", body: { skillId: "builtin:prd", input: "做一个登录页", credentialId: cred.credential?.id, model: "fake-chat", spaceId: b.projA } }));
  ok("运行内置能力并存到文档空间", (run.text || "").includes("需求分析结果SEC") && Boolean(run.pageId) && sql(`select count(*) from doc_pages where id='${run.pageId}' and projectId='${b.projA}'`) === "1");
  {
    const cross = await req("/api/skills/run", { cookie: m1, method: "POST", body: { skillId: "builtin:prd", input: "x", credentialId: cred.credential?.id, model: "fake-chat", spaceId: b.projB } });
    const none = await req("/api/skills/run", { cookie: m1, method: "POST", body: { skillId: "builtin:prd", input: "x", credentialId: cred.credential?.id, model: "fake-chat", spaceId: "no-such-space" } });
    ok("不能把结果存到别的企业的空间（与不存在一致 404）", cross.status === 404 && none.status === 404 && (await cross.text()) === (await none.text()), `${cross.status} ${none.status}`);
  }
  ok("不能用别人的模型运行", (await req("/api/skills/run", { cookie: ob, method: "POST", body: { skillId: "builtin:prd", input: "x", credentialId: cred.credential?.id, model: "fake-chat" } })).status === 402);
  const sk = await js(await req("/api/skills", { cookie: m1, method: "POST", body: { content: "---\nname: 我的技能SEC\ndescription: 测试\n---\n# 说明\n按要求回答问题。" } }));
  ok("上传个人 skill", Boolean(sk.id) && !(await (await req("/api/skills", { cookie: ob })).text()).includes("我的技能SEC"));
  ok("别人删不了我的 skill", (await req(`/api/skills/${sk.id}`, { cookie: ob, method: "DELETE" })).status === 404);
  const mr = await call(full, "run_skill", { skillId: sk.id, input: "你好", credentialId: cred.credential?.id, model: "fake-chat" });
  ok("MCP 里运行个人能力", !mr.isError && mr.content[0].text.includes("需求分析结果SEC"));
  ok("个人能力页能打开", (await req("/settings/skills", { cookie: m1 })).status === 200);
  await new Promise((r) => fake.close(r));
}


// T37 企业角色：企业超管建本企业角色，别的企业看不到、分不了；权限不超过系统超管定的企业上限
{
  const sa = (await login("admin2")).cookie, boss = (await login("manager2")).cookie, m1 = (await login("manager")).cookie, ob = (await login("outsider")).cookie;
  const created = await js(await req("/api/roles", { cookie: boss, method: "POST", body: { name: "外包SEC", copyFrom: "member", enterpriseId: "sec_ent_b" } }));
  const rk = created.role?.key, rid = created.role?.id;
  ok("企业超管建的角色归本企业（传别的企业被忽略）", Boolean(rk) && rk.startsWith("ent_") && sql(`select enterpriseId from roles where key='${rk}'`) === "sec_ent_a", created);
  ok("管理者（非企业超管）不能建角色", (await req("/api/roles", { cookie: m1, method: "POST", body: { name: "偷建SEC" } })).status === 403);
  ok("本企业看得到企业角色", (await (await req("/api/roles", { cookie: m1 })).text()).includes("外包SEC"));
  ok("别的企业看不到企业角色", !(await (await req("/api/roles", { cookie: ob })).text()).includes("外包SEC"));
  ok("别的企业改这个角色按不存在", (await req("/api/roles", { cookie: ob, method: "PATCH", body: { id: rid, name: "改SEC" } })).status === 404);
  const memberId = sql("select id from roles where key='member'");
  ok("企业超管不能改系统角色", (await req("/api/roles", { cookie: boss, method: "PATCH", body: { id: memberId, name: "改成员SEC" } })).status === 403 && sql("select name from roles where key='member'") !== "改成员SEC");
  ok("企业超管不能设企业上限", (await req("/api/roles/ceiling", { cookie: boss, method: "PUT", body: { enterpriseId: "sec_ent_a", features: ["users.manage", "bugs.delete"] } })).status === 403);
  ok("系统超管设企业上限", (await req("/api/roles/ceiling", { cookie: sa, method: "PUT", body: { enterpriseId: "sec_ent_a", features: ["requirements.create", "requirements.edit", "board.move", "bugs.edit", "docs.edit"] } })).status === 200);
  ok("超出上限的功能不能开", (await req("/api/roles", { cookie: boss, method: "PATCH", body: { id: rid, permissions: { "bugs.delete": true } } })).status === 400 && sql(`select count(*) from role_permissions where role='${rk}' and feature='bugs.delete' and allowed`) === "0");
  ok("上限内的功能可以开", (await req("/api/roles", { cookie: boss, method: "PATCH", body: { id: rid, permissions: { "docs.edit": true } } })).status === 200);
  ok("企业角色可以给本企业的人", (await req("/api/users", { cookie: boss, method: "PATCH", body: { id: uid("target"), globalRole: rk } })).status === 200);
  ok("企业角色不能给别的企业的人", (await req("/api/users", { cookie: sa, method: "PATCH", body: { id: uid("outsider"), globalRole: rk } })).status === 400 && sql(`select globalRole from users where id='${uid("outsider")}'`) !== rk);
  {
    const before = sql(`select orgId from users where id='${uid("target")}'`);
    const mv = await req("/api/users", { cookie: sa, method: "PATCH", body: { id: uid("target"), orgId: "sec_dept_b" } });
    ok("用企业角色的人不能直接换到别的企业", mv.status === 400 && sql(`select orgId from users where id='${uid("target")}'`) === before, `${mv.status} ${before}`);
  }
  ok("批量也不能把企业角色给别的企业的人", (await req("/api/users/batch", { cookie: sa, method: "PATCH", body: { ids: [uid("outsider")], globalRole: rk } })).status === 400);
  await req("/api/users", { cookie: sa, method: "PATCH", body: { id: uid("target"), globalRole: "member" } });
  ok("企业超管删本企业角色", (await req(`/api/roles?id=${rid}`, { cookie: boss, method: "DELETE" })).status === 200 && sql(`select count(*) from roles where key='${rk}'`) === "0");
  await req("/api/roles/ceiling", { cookie: sa, method: "PUT", body: { enterpriseId: "sec_ent_a", features: ["users.manage", "project.edit", "members.manage", "requirements.create", "requirements.edit", "board.move", "releases.manage", "bugs.edit", "bugs.delete", "leadership.view", "docs.edit", "products.manage"] } });
}


// T38 需求评审：看不到的需求不能评审；只有评审人能给结论；不通过要写原因；全部通过 / 有人不通过自动结束
{
  const m1 = (await login("manager")).cookie, boss = (await login("manager2")).cookie, ob = (await login("outsider")).cookie;
  sql(`insert into project_members (id, projectId, userId, role) select 'rv-sec-pm', '${b.projA}', '${uid("manager2")}', 'pm' where not exists (select 1 from project_members where projectId='${b.projA}' and userId='${uid("manager2")}')`);
  ok("别的企业看不到评审", (await req(`/api/reviews?requirementId=${b.reqA}`, { cookie: ob })).status === 404);
  ok("别的企业不能发起评审", (await req("/api/reviews", { cookie: ob, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("outsider")] } })).status === 404 && sql(`select count(*) from reviews where requirementId='${b.reqA}'`) === "0");
  ok("评审人必须是项目成员", (await req("/api/reviews", { cookie: m1, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("outsider")] } })).status === 400);
  const rv = await js(await req("/api/reviews", { cookie: m1, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("manager2")], dueAt: "2030-01-01", note: "看验收标准" } }));
  ok("发起评审", Boolean(rv.id) && sql(`select count(*) from review_votes where reviewId='${rv.id}'`) === "1", rv);
  ok("评审人收到通知", sql(`select count(*) from notifications where userId='${uid("manager2")}' and kind='review'`) !== "0");
  ok("同一需求不能同时有两个进行中的评审", (await req("/api/reviews", { cookie: m1, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("manager2")] } })).status === 409);
  ok("别的企业不能给结论（按不存在）", (await req(`/api/reviews/${rv.id}`, { cookie: ob, method: "POST", body: { action: "vote", verdict: "approve" } })).status === 404);
  ok("不是评审人不能给结论", (await req(`/api/reviews/${rv.id}`, { cookie: m1, method: "POST", body: { action: "vote", verdict: "approve" } })).status === 403);
  ok("不通过必须写原因", (await req(`/api/reviews/${rv.id}`, { cookie: boss, method: "POST", body: { action: "vote", verdict: "reject" } })).status === 400 && sql(`select status from reviews where id='${rv.id}'`) === "open");
  ok("全部通过后评审结束", (await js(await req(`/api/reviews/${rv.id}`, { cookie: boss, method: "POST", body: { action: "vote", verdict: "approve" } }))).status === "approved" && sql(`select status from reviews where id='${rv.id}'`) === "approved");
  ok("结束的评审不能再给结论", (await req(`/api/reviews/${rv.id}`, { cookie: boss, method: "POST", body: { action: "vote", verdict: "reject", comment: "晚了" } })).status === 409);
  const rv2 = await js(await req("/api/reviews", { cookie: m1, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("manager2")] } }));
  ok("不通过立即退回并通知发起人", (await js(await req(`/api/reviews/${rv2.id}`, { cookie: boss, method: "POST", body: { action: "vote", verdict: "reject", comment: "缺少异常流程SEC" } }))).status === "rejected" && sql(`select count(*) from notifications where userId='${uid("manager")}' and kind='review' and body like '%缺少异常流程SEC%'`) === "1");
  const rv3 = await js(await req("/api/reviews", { cookie: m1, method: "POST", body: { requirementId: b.reqA, reviewerIds: [uid("manager2")] } }));
  ok("别的企业不能取消评审", (await req(`/api/reviews/${rv3.id}`, { cookie: ob, method: "POST", body: { action: "cancel" } })).status === 404);
  ok("发起人可以取消", (await req(`/api/reviews/${rv3.id}`, { cookie: m1, method: "POST", body: { action: "cancel" } })).status === 200 && sql(`select status from reviews where id='${rv3.id}'`) === "cancelled");
}


// T40 飞书组织同步：只有系统超管和企业超管；企业超管只能同步本企业；没配飞书应用时不连飞书
{
  const m1 = (await login("manager")).cookie, boss = (await login("manager2")).cookie, sa = (await login("admin2")).cookie;
  ok("管理者（非企业超管）不能看组织同步", (await req("/api/system/org-sync", { cookie: m1 })).status === 403);
  ok("管理者不能执行组织同步", (await req("/api/system/org-sync", { cookie: m1, method: "POST", body: { scope: "sec_ent_a", apply: true } })).status === 403);
  const info = await js(await req("/api/system/org-sync", { cookie: boss }));
  ok("企业超管只看到本企业", Array.isArray(info.scopes) && info.scopes.length === 1 && info.scope === "sec_ent_a");
  ok("企业超管不能同步别的企业", (await req("/api/system/org-sync", { cookie: boss, method: "POST", body: { scope: "sec_ent_b", apply: true } })).status === 403);
  const before = sql("select count(*) from organizations");
  ok("没配飞书应用时提示先配置、不改数据", (await req("/api/system/org-sync", { cookie: sa, method: "POST", body: { scope: "sec_ent_b", apply: true, options: { createUsers: true } } })).status === 400 && sql("select count(*) from organizations") === before);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fails.length) console.log("失败项：\n- " + fails.join("\n- "));
process.exit(fail ? 1 : 0);
