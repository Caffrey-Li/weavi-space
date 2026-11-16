#!/usr/bin/env node
// 把 caffrey-prd-plus、caffrey-test-runner 两个 skill 的说明文件打包成系统内置能力：生成 packages/core/src/skills/builtin/content.ts
// 用法：node scripts/sync-builtin-skills.mjs [skill 所在目录]
//   目录可以是 ~/.claude/skills（默认），也可以是 caffrey-prd-plus 仓库根目录（自动用其中的 skills/）。
// 只收文字文件（.md / .ts / VERSION），不收 scripts/ 下的可执行脚本。
// 本项目自己补充、上游没有的文件放在 packages/core/src/skills/builtin/overlay/<skill>/...，打包成 OVERLAY_FILES，
// 运行时叠加在任何版本之上（包括服务端自动更新下载的新版本），所以升级不会丢。
// 服务端会按 GitHub 上的最新版本自动更新（packages/core/src/skills/updater.ts），这个脚本只决定「随代码一起发布的保底版本」。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let root = process.argv[2] || path.join(os.homedir(), ".claude", "skills");
if (fs.existsSync(path.join(root, "skills", "caffrey-prd-plus", "SKILL.md"))) root = path.join(root, "skills");
const SKILLS = ["caffrey-prd-plus", "caffrey-test-runner"];
const here = path.dirname(new URL(import.meta.url).pathname);
const builtinDir = path.join(here, "..", "packages", "core", "src", "skills", "builtin");

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.name.startsWith(".")) return [];
    if (e.isDirectory()) return e.name === "scripts" ? [] : walk(p);
    return /\.(md|ts)$/.test(e.name) || e.name === "VERSION" ? [p] : [];
  });

const out = { files: {}, versions: {}, overlay: {} };
for (const name of SKILLS) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) throw new Error(`找不到 ${dir}/SKILL.md`);
  for (const f of walk(dir).sort()) out.files[`${name}/${path.relative(dir, f).split(path.sep).join("/")}`] = fs.readFileSync(f, "utf8");
  out.versions[name] = (out.files[`${name}/VERSION`] || "").trim();
}
const overlayDir = path.join(builtinDir, "overlay");
if (fs.existsSync(overlayDir)) for (const f of walk(overlayDir).sort()) out.overlay[path.relative(overlayDir, f).split(path.sep).join("/")] = fs.readFileSync(f, "utf8");

const target = path.join(builtinDir, "content.ts");
const body = `// 由 scripts/sync-builtin-skills.mjs 生成，不要手改。来源：${SKILLS.join("、")}
export const SKILL_VERSIONS: Record<string, string> = ${JSON.stringify(out.versions, null, 2)};

export const SKILL_FILES: Record<string, string> = ${JSON.stringify(out.files, null, 2)};

/** 本项目补充、上游没有的文件（overlay/ 目录），叠加在任何版本之上 */
export const OVERLAY_FILES: Record<string, string> = ${JSON.stringify(out.overlay, null, 2)};
`;
fs.writeFileSync(target, body);
console.log(`已生成 ${path.relative(process.cwd(), target)}：${Object.keys(out.files).length} 个文件 + 补充 ${Object.keys(out.overlay).length} 个，${Math.round(body.length / 1024)} KB，版本 ${JSON.stringify(out.versions)}`);
