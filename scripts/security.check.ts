/**
 * 安全相关纯函数的回归断言（不连数据库、不起服务）：npx tsx scripts/security.check.ts
 * 覆盖：文档 HTML 清洗、SVG 清洗、跳转地址、Origin 校验、上传魔数、限流、配置加密迁移、开发密钥。
 */
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { docPlainText, extractRefs, sanitizeDocHtml } from "../apps/web/src/lib/doc-html";
import { sanitizeSvg } from "../apps/web/src/lib/svg-sanitize";
import { safeRedirectPath } from "../apps/web/src/lib/safe-path";
import { originAllowed, type OriginInput } from "../apps/web/src/lib/origin-check";
import { allowedWhileForcedChange } from "../apps/web/src/lib/force-change";
import { cleanFileName, fileMatchesType, sniffImage } from "../apps/web/src/lib/upload-guard";
import { defaultRoleAllow, outranks, roleRank } from "../apps/web/src/lib/roles-shared";
import { SYSTEM_ORG_ID, canEditOrg, canManageUser, level2OrgId, managedOrgIds, pickEnterprise, visibleOrgs, type OrgRow } from "../apps/web/src/lib/org-shared";
import { bugWhere, productWhere, requirementWhere, userWhere, type Access } from "../apps/web/src/lib/access";
import { accountLocked, clearFailures, clientIp, hitIp, recordFailure } from "../apps/web/src/lib/rate-limit";
import { CLIENT_IP_HEADER, edgeClientIp } from "../apps/web/src/lib/client-ip";

let failed = 0;
const J2 = (v: unknown) => JSON.stringify(v);
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failed++;
  console.log(`${cond ? "✓" : "✗"} ${name}${cond || detail === undefined ? "" : `\n    实际：${JSON.stringify(detail)}`}`);
}

// —— 文档 HTML
const att = "/api/attachments/cabc123def456";
const xss: [string, string][] = [
  ["img onerror", `<img src="x" onerror="alert(1)">`],
  ["合法 src 带 onerror", `<img src="${att}" onerror="alert(1)">`],
  ["script", `<script>alert(1)</script>`],
  ["javascript 链接", `<a href="javascript:alert(1)">x</a>`],
  ["大小写和实体混淆", `<a href="JaVa&#115;cript:alert(1)">x</a>`],
  ["换行混淆", `<a href="java\nscript:alert(1)">x</a>`],
  ["data 链接", `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
  ["svg onload", `<svg onload="alert(1)"><circle/></svg>`],
  ["iframe srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe>`],
  ["未闭合 img", `<img src=x onerror=alert(1) `],
  ["属性里藏标签", `<a title="><img src=x onerror=alert(1)>">x</a>`],
  ["style 事件", `<p onclick="alert(1)" style="background:url(javascript:alert(1))">x</p>`],
  ["math 变异", `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`],
  ["注释变异", `<!--><img src=x onerror=alert(1)>-->`],
  ["form action", `<form action="javascript:alert(1)"><button>x</button></form>`],
];
for (const [name, html] of xss) {
  const out = sanitizeDocHtml(html);
  ok(`清洗：${name}`, !/onerror|onclick|onload|<script|javascript:|<iframe|<svg|<form|data:text/i.test(out), out);
}
ok("外部图片被去掉", !sanitizeDocHtml(`<img src="https://evil.example/x.png">`).includes("<img"));
const keep = sanitizeDocHtml(
  `<h2 style="text-align: center">标题</h2><p>段落<b>粗</b><i>斜</i><strike>删</strike><br>换行</p>` +
    `<ul><li data-checked="true" class="doc-todo evil">任务</li></ul>` +
    `<a class="doc-ref" data-ref-kind="req" data-ref-id="cabc123def" href="/requirements/cabc123def" contenteditable="false">引用</a>` +
    `<table class="doc-table"><tbody><tr><td colspan="2">格</td></tr></tbody></table>` +
    `<div class="doc-panel" data-tone="warning">面板</div><img src="${att}" width="320" alt="图">` +
    `<a href="https://example.com/a?b=1&amp;c=2">外链</a><a href="mailto:a@example.com">信</a><a href="#h-1">锚点</a>`,
);
for (const part of [
  `<h2 data-align="center">标题</h2>`, `<strong>粗</strong>`, `<em>斜</em>`, `<s>删</s>`, `<br>`, `class="doc-todo"`, `data-checked="true"`,
  `data-ref-id="cabc123def"`, `contenteditable="false"`, `colspan="2"`, `data-tone="warning"`, `width="320"`, `src="${att}"`,
  `target="_blank"`, `rel="noopener noreferrer"`, `href="mailto:a@example.com"`, `href="#h-1"`,
]) ok(`保留：${part}`, keep.includes(part), keep);
ok("未知 class 被去掉", !keep.includes("evil"));
ok("引用可解析", extractRefs(keep).length === 1 && extractRefs(keep)[0].id === "cabc123def");
ok("外链 & 保留", keep.includes("b=1&amp;c=2"), keep);
ok("纯文本换行", docPlainText("<p>a<br>b</p>") === "a\nb", docPlainText("<p>a<br>b</p>"));
ok("反斜杠外跳被去掉", !sanitizeDocHtml(`<a href="/\\evil.com">x</a>`).includes("href"));
ok("协议相对被去掉", !sanitizeDocHtml(`<a href="//evil.com">x</a>`).includes("href"));
ok("块元素闭合 p", sanitizeDocHtml("<p>a<div>b</div>c</p>").startsWith("<p>a</p><div>b</div>"), sanitizeDocHtml("<p>a<div>b</div>c</p>"));
ok("空段落去掉", sanitizeDocHtml("<p></p><p>x</p>") === "<p>x</p>");
ok("文本转义", sanitizeDocHtml("<p>1 &lt; 2 &amp; 3</p>") === "<p>1 &lt; 2 &amp; 3</p>", sanitizeDocHtml("<p>1 &lt; 2 &amp; 3</p>"));

// —— SVG
const evil = sanitizeSvg(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="url(#g)" onclick="x()"/><a href="javascript:alert(1)"><text>t</text></a><use xlink:href="https://evil.example/a.svg#x"/><linearGradient id="g"><stop offset="0"/></linearGradient></svg>`) || "";
ok("SVG 去掉脚本和事件", evil.startsWith("<svg") && !/onload|onclick|<script|javascript:|evil\.example/.test(evil), evil);
ok("SVG 保留图形和大小写", evil.includes("<rect") && evil.includes("viewBox") && evil.includes("<linearGradient") && evil.includes('fill="url(#g)"'), evil);
ok("SVG 外部 CSS 被拒", sanitizeSvg(`<svg><style>@import url(https://evil.example/a.css);</style></svg>`) === null);
ok("SVG 外部 url() 被拒", sanitizeSvg(`<svg><rect style="fill:url(https://evil.example/a)"/></svg>`) === null);
ok("非 SVG 被拒", sanitizeSvg("<html><body>x</body></html>") === null && sanitizeSvg("hello") === null);

// —— 跳转地址
for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "\\\\evil.com", "/%0d/evil\n.com", ""]) {
  ok(`跳转拒绝：${JSON.stringify(bad)}`, safeRedirectPath(bad) === "/", safeRedirectPath(bad));
}
ok("跳转放行站内路径", safeRedirectPath("/requirements/1?x=1#a") === "/requirements/1?x=1#a");

// —— Origin
const base: OriginInput = { origin: "https://app.example.com", secFetchSite: "same-origin", host: "app.example.com", forwardedHost: null, trustProxy: false, siteUrls: [] };
ok("同源放行", originAllowed(base));
ok("跨站拒绝", !originAllowed({ ...base, origin: "https://evil.example" }));
ok("子域名拒绝", !originAllowed({ ...base, origin: "https://app.example.com.evil.example" }));
ok("Origin: null 拒绝", !originAllowed({ ...base, origin: "null" }));
ok("端口不同拒绝", !originAllowed({ ...base, origin: "https://app.example.com:8443" }));
ok("无 Origin 的脚本放行", originAllowed({ ...base, origin: null, secFetchSite: null }));
ok("无 Origin 但明确跨站拒绝", !originAllowed({ ...base, origin: null, secFetchSite: "cross-site" }));
ok("未声明代理时不信 X-Forwarded-Host", !originAllowed({ ...base, host: "10.0.0.1:3100", forwardedHost: "evil.example", origin: "https://evil.example" }));
ok("声明代理后用 X-Forwarded-Host", originAllowed({ ...base, host: "10.0.0.1:3100", forwardedHost: "app.example.com", trustProxy: true }));
ok("APP_URL 放行", originAllowed({ ...base, host: "10.0.0.1:3100", siteUrls: ["https://app.example.com"] }));

// —— 强制改密白名单
ok("改密放行", allowedWhileForcedChange("/api/auth/change-password") && allowedWhileForcedChange("/settings"));
ok("其他接口拦截", !allowedWhileForcedChange("/api/users") && !allowedWhileForcedChange("/api/auth/change-password-x") && !allowedWhileForcedChange("/"));

// —— 角色层级
ok("层级顺序", roleRank("admin") < roleRank("manager") && roleRank("manager") < roleRank("member") && roleRank("member") < roleRank("guest"));
ok("删除 Bug 默认只给管理员、管理者、项目管理员", ["admin", "manager", "project_manager"].every((r) => defaultRoleAllow(r, "bugs.delete")) && !["member", "guest", "custom_role"].some((r) => defaultRoleAllow(r, "bugs.delete")));
ok("自定义角色同成员级", roleRank("project_manager") === roleRank("member"));
ok("管理员管所有人", outranks("admin", "admin") && outranks("admin", "manager"));
ok("管理者不能管管理员", !outranks("manager", "admin"));
ok("管理者不能管同级和自己", !outranks("manager", "manager"));
ok("管理者能管成员、访客、自定义角色", outranks("manager", "member") && outranks("manager", "guest") && outranks("manager", "project_manager"));
ok("成员不能管成员", !outranks("member", "member"));

// —— 管理范围：Nova Collab › 企业（二级组织）› 部门
const org = (id: string, type: string, parentId: string | null): OrgRow => ({ id, name: id, type, parentId, sortOrder: 0 });
const tree = [org(SYSTEM_ORG_ID, "system", null), org("e1", "enterprise", SYSTEM_ORG_ID), org("d1", "department", "e1"), org("d2", "department", "d1"), org("e2", "enterprise", SYSTEM_ORG_ID), org("d3", "department", "e2")];
ok("二级组织：部门向上找到企业", level2OrgId(tree, "d2") === "e1" && level2OrgId(tree, "e1") === "e1");
ok("系统组织和无组织没有二级组织", level2OrgId(tree, SYSTEM_ORG_ID) === null && level2OrgId(tree, null) === null && level2OrgId(tree, "gone") === null);
const sc = new Set(managedOrgIds(tree, "d1"));
ok("范围是整个二级组织", ["e1", "d1", "d2"].every((x) => sc.has(x)) && !sc.has("e2") && !sc.has("d3") && !sc.has(SYSTEM_ORG_ID), Array.from(sc));
ok("挂在系统组织下的管理者什么都管不了", managedOrgIds(tree, SYSTEM_ORG_ID).length === 0);
ok("能管本企业的成员", canManageUser("manager", sc, { globalRole: "member", orgId: "d2" }));
ok("不能管别的二级组织", !canManageUser("manager", sc, { globalRole: "member", orgId: "d3" }));
ok("不能管系统组织直属和无组织的人", !canManageUser("manager", sc, { globalRole: "member", orgId: SYSTEM_ORG_ID }) && !canManageUser("manager", sc, { globalRole: "member", orgId: null }));
ok("范围内也不能管同级", !canManageUser("manager", sc, { globalRole: "manager", orgId: "d1" }));
ok("系统管理员不受限", canManageUser("admin", null, { globalRole: "manager", orgId: "d3" }));
ok("组织树只露出范围和系统组织", visibleOrgs(tree, sc).map((o) => o.id).join() === `${SYSTEM_ORG_ID},e1,d1,d2`);
ok("只能改范围内的部门", canEditOrg(sc, { id: "d1", type: "department" }) && !canEditOrg(sc, { id: "e1", type: "enterprise" }) && !canEditOrg(sc, { id: "d3", type: "department" }));

// —— 新建项目 / 产品的企业归属
const ents = ["e1", "e2"];
ok("普通账号传别的企业被忽略", J2(pickEnterprise({ isAdmin: false, own: "e1", requested: "e2", enterprises: ents })) === '{"id":"e1"}');
ok("普通账号没有企业被拒", "error" in pickEnterprise({ isAdmin: false, own: null, enterprises: ents }));
ok("普通账号不能用别的企业的产品", "error" in pickEnterprise({ isAdmin: false, own: "e1", product: { enterpriseId: "e2" }, enterprises: ents }));
ok("管理员指定企业", J2(pickEnterprise({ isAdmin: true, own: null, requested: "e2", enterprises: ents })) === '{"id":"e2"}');
ok("管理员不能指定不存在的企业", "error" in pickEnterprise({ isAdmin: true, own: null, requested: "x", enterprises: ents }));
ok("管理员指定的企业和产品要一致", "error" in pickEnterprise({ isAdmin: true, own: null, requested: "e1", product: { enterpriseId: "e2" }, enterprises: ents }));
ok("管理员没指定时跟随产品", J2(pickEnterprise({ isAdmin: true, own: "e1", product: { enterpriseId: "e2" }, enterprises: ents })) === '{"id":"e2"}');
ok("管理员推不出来时留空", J2(pickEnterprise({ isAdmin: true, own: null, enterprises: ents })) === '{"id":null}');
ok("只有一个企业时用它", J2(pickEnterprise({ isAdmin: true, own: null, enterprises: ["e1"] })) === '{"id":"e1"}');

// —— 企业隔离的查询条件
const tenantA: Access = { userId: "u", scope: "enterprise", projectIds: ["p1"], tenantIds: ["p1"], enterpriseId: "e1", orgIds: ["e1", "d1"] };
const superA: Access = { userId: "a", scope: "all", projectIds: null, tenantIds: null, enterpriseId: null, orgIds: null };
const noEnt: Access = { userId: "n", scope: "enterprise", projectIds: [], tenantIds: [], enterpriseId: null, orgIds: [] };
const J = (v: unknown) => JSON.stringify(v);
ok("系统管理员不加条件", J(requirementWhere(superA)) === "{}" && J(bugWhere(superA)) === "{}" && J(productWhere(superA)) === "{}" && J(userWhere(superA)) === "{}");
ok("需求限定本企业项目和本企业公共池", J(requirementWhere(tenantA)).includes('"p1"') && J(requirementWhere(tenantA)).includes('"e1"') && J(requirementWhere(tenantA)).includes('"projectId":null'));
ok("公共池不再无条件可见", !/\{"projectId":null\}/.test(J(requirementWhere(tenantA))) && !/\{"projectId":null\}/.test(J(bugWhere(tenantA))));
ok("「仅本人」也限定企业", J(requirementWhere({ ...tenantA, scope: "self", projectIds: [] })).includes('"p1"'));
ok("产品限定企业", J(productWhere(tenantA)).includes('"enterpriseId":"e1"') && J(productWhere({ ...tenantA, scope: "involved" })).includes('"enterpriseId":"e1"'));
ok("无企业账号的产品条件匹配不到任何数据", J(productWhere(noEnt)).includes("__none__"));
ok("人员限定企业和自己", J(userWhere(tenantA)).includes('"e1"') && J(userWhere(tenantA)).includes('"id":"u"'));

// —— 上传魔数
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
ok("PNG 识别", sniffImage(png)?.mime === "image/png");
ok("JPEG 识别", sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext === "jpg");
ok("GIF 识别", sniffImage(Buffer.from("GIF89a..."))?.mime === "image/gif");
ok("WebP 识别", sniffImage(Buffer.from("RIFF0000WEBPVP8 "))?.mime === "image/webp");
ok("HTML 冒充图片被拒", sniffImage(Buffer.from("<html><script>alert(1)</script>")) === null);
ok("SVG 不算位图", sniffImage(Buffer.from("<svg onload=alert(1)>")) === null);
ok("PDF 魔数", fileMatchesType("application/pdf", Buffer.from("%PDF-1.7")) && !fileMatchesType("application/pdf", Buffer.from("<html>")));
ok("docx 魔数", fileMatchesType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PK\x03\x04")));
ok("文本不能含 NUL", fileMatchesType("text/plain", Buffer.from("hello")) && !fileMatchesType("text/plain", Buffer.from([0x4d, 0x5a, 0, 0])));
ok("未知类型拒绝", !fileMatchesType("text/html", Buffer.from("<html>")));
ok("文件名去路径", cleanFileName("../../etc/pa\u0000sswd", "附件") === "passwd" && cleanFileName("a\\b.png", "附件") === "b.png");

// —— 限流
const t = 1_000_000;
for (let i = 0; i < 4; i++) ok(`第 ${i + 1} 次失败不锁`, recordFailure("u@x", "1.1.1.1", t + i) === false);
ok("第 5 次失败锁定", recordFailure("u@x", "1.1.1.1", t + 5) === true);
ok("锁定中", (accountLocked("u@x", "1.1.1.1", t + 6) ?? 0) > 0);
ok("别的 IP 不受这把锁影响", accountLocked("u@x", "2.2.2.2", t + 6) === null);
ok("15 分钟后解锁", accountLocked("u@x", "1.1.1.1", t + 15 * 60 * 1000 + 10) === null);
for (let i = 0; i < 15; i++) recordFailure("u@x", `3.3.3.${i}`, t + 10 + i);
ok("换 IP 累计 20 次后账号也锁", (accountLocked("u@x", "9.9.9.9", t + 100) ?? 0) > 0);
clearFailures("u@x", "1.1.1.1");
ok("成功后清零", accountLocked("u@x", "1.1.1.1", t + 100) === null);
for (let i = 0; i < 60; i++) hitIp("8.8.8.8", "t", t);
ok("IP 超限", (hitIp("8.8.8.8", "t", t) ?? 0) > 0);
ok("取不到 IP 不计数", hitIp("unknown", "t", t) === null);
const spoof = new Headers({ "x-forwarded-for": "1.2.3.4" });
ok("未声明代理不信 XFF", clientIp(spoof) === "unknown");
const nf = new Headers({ "x-nf-client-connection-ip": "5.5.5.5", "x-forwarded-for": "6.6.6.6", [CLIENT_IP_HEADER]: "7.7.7.7" });
ok("非 Netlify 不信 Netlify 的头和内部头", clientIp(nf) === "unknown");
process.env.TRUST_PROXY = "1";
ok("声明代理也不信 Netlify 的头和内部头", clientIp(new Headers({ "x-nf-client-connection-ip": "5.5.5.5", [CLIENT_IP_HEADER]: "7.7.7.7" })) === "unknown");
delete process.env.TRUST_PROXY;
process.env.TRUST_NETLIFY_IP = "1";
ok("Netlify 只读 proxy 写的内部头", clientIp(nf) === "7.7.7.7");
ok("Netlify 上不看 XFF 和平台头", clientIp(new Headers({ "x-nf-client-connection-ip": "5.5.5.5", "x-forwarded-for": "6.6.6.6" })) === "unknown");
delete process.env.TRUST_NETLIFY_IP;
ok("边缘取 XFF 最后一项", edgeClientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" })) === "1.2.3.4");
ok("边缘没有 XFF 算取不到", edgeClientIp(new Headers()) === null);
process.env.TRUST_PROXY = "1";
ok("声明代理取最后一跳", clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" })) === "1.2.3.4");
delete process.env.TRUST_PROXY;

async function keys() {
  // —— 配置加密：旧密文（AUTH_SECRET 派生）能读，配了 ENCRYPTION_KEY 后新写入用 keyVersion 2
  const dir = mkdtempSync(path.join(tmpdir(), "pm-sec-"));
  const cwd = process.cwd();
  process.chdir(dir);
  const env = { ...process.env };
  try {
    process.env.AUTH_SECRET = "a".repeat(40);
    delete process.env.ENCRYPTION_KEY;
    const { sealText, openText } = await import("../apps/web/src/lib/secure-config");
    const old = sealText("机密");
    ok("没配 ENCRYPTION_KEY 时用 keyVersion 1", JSON.parse(old).keyVersion === 1);
    // 改造前的格式：没有 keyVersion
    const { keyVersion: _omit, ...legacy } = JSON.parse(old);
    void _omit;
    process.env.ENCRYPTION_KEY = "b".repeat(40);
    ok("配置后旧密文可读", openText(old) === "机密");
    ok("没有 keyVersion 的旧格式可读", openText(JSON.stringify({ ...legacy, v: 1 })) === "机密");
    const next = sealText("机密");
    ok("新写入迁移到 keyVersion 2", JSON.parse(next).keyVersion === 2 && openText(next) === "机密");
    process.env.ENCRYPTION_KEY = "c".repeat(40);
    ok("换了 ENCRYPTION_KEY 解不开（不报错）", openText(next) === null);
    process.env.AUTH_SECRET = "d".repeat(40);
    ok("换了 AUTH_SECRET 旧密文解不开", openText(old) === null);

    // —— 开发环境随机密钥；生产环境拒绝
    const { authSecretProblem, authSecretString } = await import("../apps/web/src/lib/auth-secret");
    delete process.env.AUTH_SECRET;
    ok("缺密钥能识别", authSecretProblem() !== null);
    const warn = console.warn;
    console.warn = () => undefined;
    const dev = authSecretString();
    console.warn = warn;
    ok("开发环境生成随机密钥并落盘", dev.length >= 32 && dev !== "dev-secret" && readFileSync(path.join(dir, ".data", "dev-auth-secret"), "utf8") === dev);
    process.env.AUTH_SECRET = "short";
    (process.env as Record<string, string>).NODE_ENV = "production";
    let threw = false;
    try {
      authSecretString();
    } catch {
      threw = true;
    }
    ok("生产环境短密钥直接报错", threw);
  } finally {
    process.env = env;
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

keys().then(() => {
  console.log(failed ? `\n失败 ${failed} 项` : "\n全部通过");
  process.exit(failed ? 1 : 0);
});
