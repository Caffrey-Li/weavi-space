import { prisma } from "@pm-collab/db/prisma";
import type { Prisma } from "@prisma/client";
import { openText, sealText } from "../shared/secure-config";
import { applySkillPack, refreshSkillPacks, skillVersions, wikiCommit } from "./store";
import { WIKI_SKILL_NAME } from "./builtin/wiki-content";

/**
 * Wiki 输出规范（wiki-output-style）在线更新：仓库 Caffrey-Li/chatgpt-wiki-skill 是私有的，
 * 系统超管在「个人能力」页填一个只读的 GitHub 令牌（加密存 system_settings.wikiSkillToken），
 * 和内置能力自动更新同一个节奏检查：最新提交和当前不同就下载 wiki-output-style/ 下的 .md，存进 builtin_skill_packs。
 * 只连固定仓库（环境变量 WIKI_SKILL_REPO 可改），按提交号下载；文件只作为给模型的说明文字。
 */
const REPO = () => process.env.WIKI_SKILL_REPO || "Caffrey-Li/chatgpt-wiki-skill";
const BRANCH = () => process.env.WIKI_SKILL_BRANCH || "main";
const TOKEN_KEY = "wikiSkillToken";
const MAX_FILES = 60;
const MAX_FILE = 300 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const TIMEOUT = 20_000;
type Fetcher = typeof fetch;

export const wikiRepo = REPO;

/** 仓库路径 → skill 内的相对路径；只收 wiki-output-style/ 下的 .md，不收隐藏文件和 scripts/ */
export function wikiAllowedPath(path: string): string | null {
  const prefix = `${WIKI_SKILL_NAME}/`;
  if (!path.startsWith(prefix)) return null;
  const rel = path.slice(prefix.length);
  if (!rel || rel.includes("..") || rel.split("/").some((s) => !s || s.startsWith("."))) return null;
  if (rel.startsWith("scripts/") || !/^[\w./-]+$/.test(rel)) return null;
  return /\.md$/.test(rel) ? rel : null;
}

/** 版本 = 提交时间（UTC，到分钟）+ 短提交号，和 scripts/sync-wiki-skill.mjs 一致 */
export function wikiVersion(committedAt: string, sha: string) {
  const t = new Date(committedAt).toISOString();
  return `${t.slice(0, 10)}.${t.slice(11, 13)}${t.slice(14, 16)}-${sha.slice(0, 7)}`;
}

export async function wikiToken() {
  const row = await prisma.systemSetting.findUnique({ where: { key: TOKEN_KEY } });
  return row ? openText(row.value) : null;
}

export function maskToken(t: string | null) {
  if (!t) return null;
  return `${t.slice(0, t.startsWith("github_pat_") ? 11 : 4)}…${t.slice(-4)}`;
}

async function get(f: Fetcher, url: string, token: string, accept: string) {
  const res = await f(url, { headers: { "User-Agent": "weavi-space-skill-updater", Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (res.status === 401) throw new Error("GitHub 令牌无效或已过期");
  if (res.status === 403 || res.status === 404) throw new Error(`令牌没有读取 ${REPO()} 的权限（HTTP ${res.status}）`);
  if (!res.ok) throw new Error(`GitHub 返回 HTTP ${res.status}`);
  return res.text();
}

async function latestCommit(f: Fetcher, token: string) {
  const c = JSON.parse(await get(f, `https://api.github.com/repos/${REPO()}/commits/${BRANCH()}`, token, "application/vnd.github+json")) as { sha?: string; commit?: { committer?: { date?: string } } };
  if (!c.sha || !/^[0-9a-f]{40}$/.test(c.sha) || !c.commit?.committer?.date) throw new Error("读不到仓库的最新提交");
  return { sha: c.sha, date: c.commit.committer.date };
}

/** 保存令牌前先试一次能不能读到仓库；token 为空表示移除 */
export async function setWikiToken(raw: unknown, f: Fetcher = fetch): Promise<{ ok: true } | { error: string }> {
  const token = String(raw ?? "").trim();
  if (!token) {
    await prisma.systemSetting.deleteMany({ where: { key: TOKEN_KEY } });
    return { ok: true };
  }
  if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})$/.test(token)) return { error: "这不像 GitHub 令牌（应以 github_pat_ 或 ghp_ 开头）" };
  try {
    await latestCommit(f, token);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const value = sealText(token);
  await prisma.systemSetting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } });
  return { ok: true };
}

/** 检查并更新；没配令牌返回 skipped。返回更新说明（没更新为 null） */
export async function checkWikiSkill(opts: { by?: string | null; fetcher?: Fetcher } = {}): Promise<{ skipped: true } | { updated: string | null }> {
  const f = opts.fetcher || fetch;
  const token = await wikiToken();
  if (!token) return { skipped: true };
  await refreshSkillPacks(true);
  const cur = skillVersions()[WIKI_SKILL_NAME] || "";
  const head = await latestCommit(f, token);
  const curCommit = wikiCommit();
  if (curCommit && head.sha.startsWith(curCommit)) return { updated: null };
  const version = wikiVersion(head.date, head.sha);
  if (cur && version <= cur) return { updated: null };
  const tree = JSON.parse(await get(f, `https://api.github.com/repos/${REPO()}/git/trees/${head.sha}?recursive=1`, token, "application/vnd.github+json")) as { tree?: { path: string; type: string; size?: number }[] };
  if (!tree.tree) throw new Error("读不到仓库文件列表");
  const entries = tree.tree.filter((e) => e.type === "blob").map((e) => ({ rel: wikiAllowedPath(e.path), path: e.path, size: e.size || 0 })).filter((e) => e.rel) as { rel: string; path: string; size: number }[];
  if (!entries.length) throw new Error(`仓库里没有 ${WIKI_SKILL_NAME}/`);
  if (entries.length > MAX_FILES) throw new Error(`文件太多（${entries.length} 个）`);
  const files: Record<string, string> = {};
  let total = 0;
  for (const e of entries) {
    if (e.size > MAX_FILE) throw new Error(`${e.rel} 超过 300 KB`);
    const text = await get(f, `https://api.github.com/repos/${REPO()}/contents/${e.path.split("/").map(encodeURIComponent).join("/")}?ref=${head.sha}`, token, "application/vnd.github.raw");
    total += text.length;
    if (total > MAX_TOTAL) throw new Error("总大小超过 2 MB");
    files[e.rel] = text;
  }
  if (!files["SKILL.md"]) throw new Error(`${WIKI_SKILL_NAME} 缺少 SKILL.md`);
  const now = new Date();
  await prisma.builtinSkillPack.upsert({
    where: { skill: WIKI_SKILL_NAME },
    create: { skill: WIKI_SKILL_NAME, version, commit: head.sha, files: files as Prisma.InputJsonObject, fetchedAt: now, updatedById: opts.by || null },
    update: { version, commit: head.sha, files: files as Prisma.InputJsonObject, fetchedAt: now, updatedById: opts.by || null },
  });
  applySkillPack(WIKI_SKILL_NAME, { version, commit: head.sha, fetchedAt: now, files });
  return { updated: `${WIKI_SKILL_NAME} ${cur || "?"} → ${version}` };
}
