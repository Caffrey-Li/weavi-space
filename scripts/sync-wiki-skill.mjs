#!/usr/bin/env node
// 把 Wiki 输出规范 skill（wiki-output-style，来自用户的私有仓库 chatgpt-wiki-skill）打包成系统内置能力：
// 生成 packages/core/src/skills/builtin/wiki-content.ts。
// 用法：node scripts/sync-wiki-skill.mjs <chatgpt-wiki-skill 仓库目录>
// 只收 .md 文字文件（图片、CSV 只是 skill 自带的演示素材，系统里用不到）。版本取 VERSION 文件，没有就用「提交时间-短提交号」。
// 仓库是私有的：scripts/export-public.sh 导出公开代码时会把 wiki-content.ts 换成空壳，内置能力列表里随之不显示。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
if (!repo) throw new Error("用法：node scripts/sync-wiki-skill.mjs <chatgpt-wiki-skill 仓库目录>");
const NAME = "wiki-output-style";
const dir = path.join(repo, NAME);
if (!fs.existsSync(path.join(dir, "SKILL.md"))) throw new Error(`找不到 ${dir}/SKILL.md`);
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.name.startsWith(".")) return [];
    if (e.isDirectory()) return e.name === "scripts" ? [] : walk(p);
    return /\.md$/.test(e.name) ? [p] : [];
  });
const files = {};
for (const f of walk(dir).sort()) files[path.relative(dir, f).split(path.sep).join("/")] = fs.readFileSync(f, "utf8");
let version = fs.existsSync(path.join(dir, "VERSION")) ? fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim() : "";
if (!version) {
  try {
    // 版本 = 提交时间（UTC，到分钟）+ 短提交号，可按字符串比较新旧；和服务端在线更新用同一种写法
    const [iso, sha] = execFileSync("git", ["-C", repo, "log", "-1", "--format=%cI %H"], { encoding: "utf8" }).trim().split(" ");
    const t = new Date(iso).toISOString();
    version = `${t.slice(0, 10)}.${t.slice(11, 13)}${t.slice(14, 16)}-${sha.slice(0, 7)}`;
  } catch {
    version = "unknown";
  }
}
const here = path.dirname(new URL(import.meta.url).pathname);
const target = path.join(here, "..", "packages", "core", "src", "skills", "builtin", "wiki-content.ts");
const body = `// 由 scripts/sync-wiki-skill.mjs 生成，不要手改。来源：私有仓库 chatgpt-wiki-skill 的 ${NAME}（公开导出时替换成空壳）
export const WIKI_SKILL_NAME = ${JSON.stringify(NAME)};
export const WIKI_SKILL_VERSION = ${JSON.stringify(version)};
export const WIKI_SKILL_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};
`;
fs.writeFileSync(target, body);
console.log(`已生成 ${path.relative(process.cwd(), target)}：${Object.keys(files).length} 个文件，${Math.round(body.length / 1024)} KB，版本 ${version}`);
