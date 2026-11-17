import { prisma } from "@pm-collab/db/prisma";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { BUILTIN_SKILL_NAMES, compareVersion, packInfo, refreshSkillPacks, skillVersions, applySkillPack } from "./store";
import { checkWikiSkill, maskToken, setWikiToken, wikiRepo, wikiToken } from "./wiki-updater";

/**
 * 内置 skill 自动更新：从 GitHub 上的 caffrey-prd-plus 仓库检查 skills/<名称>/VERSION，版本更高就下载这个 skill 的文字文件
 * （.md / .ts / VERSION，不含 scripts/），存进 builtin_skill_packs，各进程一分钟内生效。
 * - 自动：任务队列每小时看一次，距上次检查满 24 小时才真正去 GitHub（系统设置 skillAutoUpdate = off 时不自动）；
 * - 手动：系统超管在「个人能力」页点「检查更新」；
 * - 安全：只连固定的仓库（环境变量 BUILTIN_SKILLS_REPO 可改），按提交号下载保证一致；限制文件类型、路径、数量和大小；
 *   下载的内容只作为给模型的说明文字，不执行。
 */
const REPO = () => process.env.BUILTIN_SKILLS_REPO || "Caffrey-Li/caffrey-prd-plus";
const BRANCH = () => process.env.BUILTIN_SKILLS_BRANCH || "main";
const AUTO_KEY = "skillAutoUpdate";
const CHECK_KEY = "skillUpdateCheck";
const CHECK_EVERY = 24 * 3600_000;
const MAX_FILES = 200;
const MAX_FILE = 400 * 1024;
const MAX_TOTAL = 4 * 1024 * 1024;
const TIMEOUT = 20_000;

export type CheckRecord = { at: string; ok: boolean; error: string | null; latest: Record<string, string>; updated: string[]; wikiError?: string | null };
type Fetcher = typeof fetch;

/** 仓库里的路径 → skill 内的相对路径；不符合规则的返回 null */
export function allowedPath(path: string, skill: string): string | null {
  const prefix = `skills/${skill}/`;
  if (!path.startsWith(prefix)) return null;
  const rel = path.slice(prefix.length);
  if (!rel || rel.includes("..") || rel.split("/").some((s) => !s || s.startsWith("."))) return null;
  if (rel.startsWith("scripts/")) return null;
  if (!/^[\w./-]+$/.test(rel)) return null;
  return rel === "VERSION" || /\.(md|ts)$/.test(rel) ? rel : null;
}

async function getText(f: Fetcher, url: string, accept?: string) {
  const res = await f(url, { headers: { "User-Agent": "weavi-space-skill-updater", ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} 返回 HTTP ${res.status}`);
  return res.text();
}

/** 远端最新版本号 */
export async function remoteVersions(f: Fetcher = fetch): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of BUILTIN_SKILL_NAMES) {
    const v = (await getText(f, `https://raw.githubusercontent.com/${REPO()}/${BRANCH()}/skills/${s}/VERSION`)).trim();
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`${s} 的远端版本号格式不对：${v.slice(0, 20)}`);
    out[s] = v;
  }
  return out;
}

/** 按提交号下载一个 skill 的文字文件 */
export async function downloadSkill(skill: string, f: Fetcher = fetch): Promise<{ commit: string; version: string; files: Record<string, string> }> {
  const commit = JSON.parse(await getText(f, `https://api.github.com/repos/${REPO()}/commits/${BRANCH()}`, "application/vnd.github+json")) as { sha?: string };
  if (!commit.sha || !/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error("读不到仓库的最新提交");
  const tree = JSON.parse(await getText(f, `https://api.github.com/repos/${REPO()}/git/trees/${commit.sha}?recursive=1`, "application/vnd.github+json")) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
  if (!tree.tree) throw new Error("读不到仓库文件列表");
  const entries = tree.tree.filter((e) => e.type === "blob").map((e) => ({ rel: allowedPath(e.path, skill), path: e.path, size: e.size || 0 })).filter((e) => e.rel) as { rel: string; path: string; size: number }[];
  if (!entries.length) throw new Error(`仓库里没有 skills/${skill}`);
  if (entries.length > MAX_FILES) throw new Error(`${skill} 文件太多（${entries.length} 个）`);
  const files: Record<string, string> = {};
  let total = 0;
  for (const e of entries) {
    if (e.size > MAX_FILE) throw new Error(`${e.rel} 超过 400 KB`);
    const text = await getText(f, `https://raw.githubusercontent.com/${REPO()}/${commit.sha}/${e.path}`);
    total += text.length;
    if (total > MAX_TOTAL) throw new Error(`${skill} 总大小超过 4 MB`);
    files[e.rel] = text;
  }
  if (!files["SKILL.md"]) throw new Error(`${skill} 缺少 SKILL.md`);
  const version = (files.VERSION || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${skill} 的 VERSION 格式不对`);
  return { commit: commit.sha, version, files };
}

async function setting(key: string) {
  return (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? null;
}
async function saveSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function lastCheck(): Promise<CheckRecord | null> {
  try {
    return JSON.parse((await setting(CHECK_KEY)) || "null");
  } catch {
    return null;
  }
}

/** 检查并（版本更高时）下载启用。返回这次的检查记录 */
export async function checkAndUpdate(opts: { by?: string | null; fetcher?: Fetcher } = {}): Promise<CheckRecord> {
  const f = opts.fetcher || fetch;
  await refreshSkillPacks(true);
  const rec: CheckRecord = { at: new Date().toISOString(), ok: true, error: null, latest: {}, updated: [] };
  try {
    rec.latest = await remoteVersions(f);
    const cur = skillVersions();
    for (const s of BUILTIN_SKILL_NAMES) {
      if (compareVersion(rec.latest[s], cur[s] || "") <= 0) continue;
      const pack = await downloadSkill(s, f);
      if (compareVersion(pack.version, cur[s] || "") <= 0) continue;
      const now = new Date();
      await prisma.builtinSkillPack.upsert({
        where: { skill: s },
        create: { skill: s, version: pack.version, commit: pack.commit, files: pack.files as Prisma.InputJsonObject, fetchedAt: now, updatedById: opts.by || null },
        update: { version: pack.version, commit: pack.commit, files: pack.files as Prisma.InputJsonObject, fetchedAt: now, updatedById: opts.by || null },
      });
      applySkillPack(s, { version: pack.version, commit: pack.commit, fetchedAt: now, files: pack.files });
      rec.updated.push(`${s} ${cur[s] || "?"} → ${pack.version}`);
    }
  } catch (e) {
    rec.ok = false;
    rec.error = String((e as Error).message || e).slice(0, 300);
  }
  // Wiki 输出规范（私有仓库，配了令牌才检查）：失败单独记，不影响上面两个
  try {
    const w = await checkWikiSkill({ by: opts.by, fetcher: opts.fetcher });
    if ("updated" in w && w.updated) rec.updated.push(w.updated);
    rec.wikiError = null;
  } catch (e) {
    rec.wikiError = String((e as Error).message || e).slice(0, 300);
  }
  await saveSetting(CHECK_KEY, JSON.stringify(rec));
  if (rec.updated.length) console.log(`[内置能力] 已更新：${rec.updated.join("；")}`);
  return rec;
}

/** 任务队列每小时调用：自动更新开着、且距上次检查满 24 小时才检查 */
export async function autoUpdateTick(now = Date.now()) {
  if ((await setting(AUTO_KEY)) === "off") return null;
  const last = await lastCheck();
  if (last && now - new Date(last.at).getTime() < CHECK_EVERY) return null;
  return checkAndUpdate();
}

// ---------- 接口（个人能力页） ----------

export async function updateStatus(session: SessionUser) {
  await refreshSkillPacks();
  const canManage = session.globalRole === ADMIN_ROLE;
  const token = canManage ? await wikiToken() : null;
  return result({ packs: packInfo(), auto: (await setting(AUTO_KEY)) !== "off", lastCheck: await lastCheck(), canManage, repo: REPO(), wiki: canManage ? { repo: wikiRepo(), token: maskToken(token) } : null });
}

/** { action: "check" } 立即检查并更新；{ action: "auto", on } 开关自动更新。只有系统超管 */
export async function updateAction(session: SessionUser, body: Record<string, unknown>) {
  if (session.globalRole !== ADMIN_ROLE) return result({ error: "只有系统超管可以更新内置能力" }, { status: 403 });
  if (body.action === "auto") {
    await saveSetting(AUTO_KEY, body.on === false ? "off" : "on");
    return updateStatus(session);
  }
  if (body.action === "wikiToken") {
    const r = await setWikiToken(body.token);
    if ("error" in r) return result({ error: r.error }, { status: 400 });
    return updateStatus(session);
  }
  if (body.action === "check") {
    const rec = await checkAndUpdate({ by: session.id });
    if (!rec.ok) return result({ error: `检查更新失败：${rec.error}` }, { status: 502 });
    return updateStatus(session);
  }
  return result({ error: "不支持的操作" }, { status: 400 });
}
