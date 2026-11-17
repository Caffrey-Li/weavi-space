import { prisma } from "@pm-collab/db/prisma";
import { OVERLAY_FILES, SKILL_FILES, SKILL_VERSIONS } from "./builtin/content";
import { WIKI_SKILL_FILES, WIKI_SKILL_NAME, WIKI_SKILL_VERSION } from "./builtin/wiki-content";

/**
 * 内置 skill 的当前内容：随代码发布的保底版本（builtin/content.ts）+ 服务端从 GitHub 下载的新版本（builtin_skill_packs），
 * 哪个版本号高用哪个；本项目补充的文件（OVERLAY_FILES）叠加在最上面。多进程部署时各进程每分钟从库里刷新一次。
 */
export const BUILTIN_SKILL_NAMES = ["caffrey-prd-plus", "caffrey-test-runner"] as const;

export type SkillPackInfo = { skill: string; version: string; source: "bundled" | "online"; commit: string | null; fetchedAt: string | null; bundledVersion: string };
type Pack = { version: string; source: "bundled" | "online"; commit: string | null; fetchedAt: Date | null; files: Record<string, string> };

/** 比较 x.y.z 版本号：a > b 返回 1，相等 0，a < b 返回 -1；不是版本号的当成 0.0.0 */
export function compareVersion(a: string, b: string) {
  const p = (v: string) => (/^\d+(\.\d+){0,2}$/.test(v.trim()) ? v.trim().split(".").map(Number) : [0]);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function bundled(skill: string): Pack {
  const files: Record<string, string> = {};
  const prefix = `${skill}/`;
  for (const [k, v] of Object.entries(SKILL_FILES)) if (k.startsWith(prefix)) files[k.slice(prefix.length)] = v;
  return { version: SKILL_VERSIONS[skill] || "", source: "bundled", commit: null, fetchedAt: null, files };
}

let packs: Record<string, Pack> = Object.fromEntries(BUILTIN_SKILL_NAMES.map((s) => [s, bundled(s)]));

/**
 * Wiki 输出规范（私有仓库）：随代码打包一份，配了 GitHub 令牌后服务端在线更新（wiki-updater.ts）。
 * 版本写成「提交时间-短提交号」（2026-11-17.0716-3dac2b7），按字符串比较新旧。
 */
function wikiBundled(): Pack {
  return { version: WIKI_SKILL_FILES["SKILL.md"] ? WIKI_SKILL_VERSION : "", source: "bundled", commit: WIKI_SKILL_VERSION.split("-").pop() || null, fetchedAt: null, files: WIKI_SKILL_FILES };
}
export const isNewerWiki = (a: string, b: string) => Boolean(a) && a > (b || "");
let wikiPack: Pack = wikiBundled();
let merged: Record<string, string> | null = null;
let loadedAt = 0;
const TTL = 60_000;

/** 用下载的版本替换（只在版本号更高时）；refreshSkillPacks 和更新完成后调用 */
export function applySkillPack(skill: string, p: { version: string; commit: string; fetchedAt: Date; files: Record<string, string> }) {
  if (skill === WIKI_SKILL_NAME) {
    const base = wikiBundled();
    wikiPack = isNewerWiki(p.version, base.version) ? { ...p, source: "online" } : base;
    merged = null;
    return;
  }
  const base = bundled(skill);
  packs[skill] = compareVersion(p.version, base.version) > 0 ? { ...p, source: "online" } : base;
  merged = null;
}

/** 从库里读下载的版本（每个进程最多每分钟一次；force 时立刻读） */
export async function refreshSkillPacks(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return;
  loadedAt = Date.now();
  try {
    const rows = await prisma.builtinSkillPack.findMany();
    const next: Record<string, Pack> = Object.fromEntries(BUILTIN_SKILL_NAMES.map((s) => [s, bundled(s)]));
    let wiki = wikiBundled();
    for (const r of rows) {
      if (r.skill === WIKI_SKILL_NAME && r.files && typeof r.files === "object" && isNewerWiki(r.version, wiki.version)) wiki = { version: r.version, source: "online", commit: r.commit, fetchedAt: r.fetchedAt, files: r.files as Record<string, string> };
      if (!(r.skill in next) || !r.files || typeof r.files !== "object") continue;
      if (compareVersion(r.version, next[r.skill].version) > 0) next[r.skill] = { version: r.version, source: "online", commit: r.commit, fetchedAt: r.fetchedAt, files: r.files as Record<string, string> };
    }
    packs = next;
    wikiPack = wiki;
    merged = null;
  } catch (e) {
    // 库还没迁移或暂时连不上：继续用当前内容
    console.error("[内置能力] 读取在线版本失败，继续用当前版本", (e as Error).message);
  }
}

/** 当前生效的全部文件：{ "skill/相对路径": 内容 }，补充文件叠加在上面 */
export function skillFiles(): Record<string, string> {
  if (merged) return merged;
  const out: Record<string, string> = {};
  for (const [skill, p] of Object.entries(packs)) for (const [k, v] of Object.entries(p.files)) out[`${skill}/${k}`] = v;
  // Wiki 输出规范：打包版或在线更新的版本
  for (const [k, v] of Object.entries(wikiPack.files)) out[`${WIKI_SKILL_NAME}/${k}`] = v;
  for (const [k, v] of Object.entries(OVERLAY_FILES)) out[k] = v;
  merged = out;
  return out;
}

export function skillVersions(): Record<string, string> {
  const out = Object.fromEntries(Object.entries(packs).map(([k, p]) => [k, p.version]));
  if (wikiPack.files["SKILL.md"]) out[WIKI_SKILL_NAME] = wikiPack.version;
  return out;
}

export function packInfo(): SkillPackInfo[] {
  const list: SkillPackInfo[] = BUILTIN_SKILL_NAMES.map((s) => ({ skill: s as string, version: packs[s].version, source: packs[s].source, commit: packs[s].commit, fetchedAt: packs[s].fetchedAt ? packs[s].fetchedAt!.toISOString() : null, bundledVersion: SKILL_VERSIONS[s] || "" }));
  if (wikiPack.files["SKILL.md"]) list.push({ skill: WIKI_SKILL_NAME, version: wikiPack.version, source: wikiPack.source, commit: wikiPack.commit, fetchedAt: wikiPack.fetchedAt ? wikiPack.fetchedAt.toISOString() : null, bundledVersion: wikiBundled().version });
  return list;
}

/** 当前 Wiki 输出规范的提交号（打包版是短提交号） */
export function wikiCommit() {
  return wikiPack.commit || "";
}

/** 测试用：回到随代码发布的版本 */
export function resetSkillPacksForTest() {
  packs = Object.fromEntries(BUILTIN_SKILL_NAMES.map((s) => [s, bundled(s)]));
  wikiPack = wikiBundled();
  merged = null;
  loadedAt = 0;
}
