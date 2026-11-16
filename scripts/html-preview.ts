/**
 * 把正在运行的站点抓成一个可以双击打开的单文件 HTML 预览（静态快照，不连服务器）。
 * 页面里的链接改成 #/路径 在文件内切换；按钮、弹窗、拖拽等需要接口的交互不可用。
 *
 * 用法：npx tsx scripts/html-preview.ts <站点地址> <输出文件>
 * 一般通过 scripts/html-preview.sh 调用（它会用演示数据起临时服务）。
 */
import fs from "node:fs";

const BASE = (process.argv[2] || "http://localhost:3102").replace(/\/$/, "");
const OUT = process.argv[3] || "nova-collab-preview.html";
const MAX_PAGES = 300;
const LOGIN = { email: "admin@local", password: "Admin123!" };

let cookie = "";

async function get(path: string, withCookie = true) {
  const res = await fetch(BASE + path, { headers: withCookie && cookie ? { cookie } : {}, redirect: "manual" });
  return res;
}

async function login() {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(LOGIN),
  });
  if (!res.ok) throw new Error(`登录失败：${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const dataUriCache = new Map<string, string>();
async function toDataUri(path: string) {
  if (dataUriCache.has(path)) return dataUriCache.get(path)!;
  const res = await get(path);
  if (!res.ok) return path;
  const type = (res.headers.get("content-type") || "application/octet-stream").split(";")[0];
  const uri = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  dataUriCache.set(path, uri);
  return uri;
}

function isPageLink(href: string) {
  return href.startsWith("/") && !href.startsWith("//") && !/^\/(_next|api|uploads)\//.test(href) && !/\.[a-z0-9]{2,4}(\?|$)/i.test(href);
}

async function inlineCss(css: string) {
  const urls = Array.from(new Set(Array.from(css.matchAll(/url\((\/[^)"']+)\)/g), (m) => m[1])));
  for (const u of urls) css = css.split(`url(${u})`).join(`url(${await toDataUri(u)})`);
  return css;
}

async function main() {
  await login();
  const pages: Record<string, { bodyAttrs: string; html: string }> = {};
  const cssHrefs = new Set<string>();
  let htmlAttrs = "";
  const queue = ["/", "/login", "/products", "/requirements/new", "/bugs/new"];
  const seen = new Set(queue);

  while (queue.length && Object.keys(pages).length < MAX_PAGES) {
    const route = queue.shift()!;
    const res = await get(route, route !== "/login");
    if (res.status !== 200) {
      console.log(`跳过 ${route}（${res.status}）`);
      continue;
    }
    const doc = await res.text();
    htmlAttrs ||= (doc.match(/<html([^>]*)>/) || ["", ""])[1];
    for (const m of Array.from(doc.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g))) cssHrefs.add(m[1]);
    const bodyMatch = doc.match(/<body([^>]*)>([\s\S]*)<\/body>/);
    if (!bodyMatch) continue;
    let body = bodyMatch[2]
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]*>/g, "");

    for (const m of Array.from(body.matchAll(/href="([^"]+)"/g))) {
      const href = m[1].replace(/&amp;/g, "&");
      if (isPageLink(href) && !seen.has(href)) {
        seen.add(href);
        queue.push(href);
      }
    }
    const imgs = Array.from(new Set(Array.from(body.matchAll(/src="(\/[^"]+)"/g), (m) => m[1])));
    for (const src of imgs) body = body.split(`src="${src}"`).join(`src="${await toDataUri(src.replace(/&amp;/g, "&"))}"`);
    body = body.replace(/href="(\/[^"]*)"/g, (all, href: string) => (isPageLink(href.replace(/&amp;/g, "&")) ? `href="#${href}"` : all));
    pages[route] = { bodyAttrs: bodyMatch[1], html: body };
    console.log(`✓ ${route}`);
  }

  let css = "";
  for (const href of Array.from(cssHrefs)) css += await inlineCss(await (await get(href)).text());
  const icon = await toDataUri("/icon.svg");
  const json = JSON.stringify(pages).replace(/</g, "\\u003c");

  const out = `<!doctype html>
<html${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nova Collab · 本地预览</title>
<link rel="icon" href="${icon}">
<style>${css}</style>
<style>
#preview-note{position:fixed;right:12px;bottom:12px;z-index:9999;font:12px/1.5 system-ui,sans-serif;background:rgba(17,24,39,.86);color:#fff;padding:6px 10px;border-radius:8px;pointer-events:none}
</style>
</head>
<body>
<div id="preview-note">静态预览 · 演示数据 · 生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}</div>
<script type="application/json" id="preview-pages">${json}</script>
<script>
(function () {
  var pages = JSON.parse(document.getElementById("preview-pages").textContent);
  var note = document.getElementById("preview-note");
  function show() {
    var route = decodeURIComponent(location.hash.slice(1)) || "/";
    var page = pages[route] || pages[route.split("?")[0]];
    var body = document.body;
    Array.prototype.slice.call(body.attributes).forEach(function (a) { body.removeAttribute(a.name); });
    if (!page) {
      body.innerHTML = '<div style="padding:48px;font:14px system-ui">这个页面没有包含在预览里。<a href="#/">回到工作台</a></div>';
    } else {
      var tmp = document.createElement("div");
      tmp.innerHTML = "<span " + page.bodyAttrs + "></span>";
      Array.prototype.slice.call(tmp.firstChild.attributes).forEach(function (a) { body.setAttribute(a.name, a.value); });
      body.innerHTML = page.html;
    }
    body.appendChild(note);
    window.scrollTo(0, 0);
  }
  document.addEventListener("submit", function (e) { e.preventDefault(); });
  window.addEventListener("hashchange", show);
  show();
})();
</script>
</body>
</html>`;
  fs.writeFileSync(OUT, out);
  console.log(`共 ${Object.keys(pages).length} 个页面，输出 ${OUT}（${(out.length / 1024 / 1024).toFixed(1)} MB）`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
