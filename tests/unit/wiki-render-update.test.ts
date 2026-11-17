import { beforeEach, describe, expect, it, vi } from "vitest";

/** Wiki 渲染（流程图、公式、提示块的 HTML）和 Wiki 输出规范的在线更新（私有仓库 + 令牌） */
const db = vi.hoisted(() => ({ settings: new Map<string, string>(), packs: new Map<string, Record<string, unknown>>() }));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key)! } : null)),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => db.settings.set(where.key, create.value)),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => db.settings.delete(where.key)),
    },
    builtinSkillPack: {
      findMany: vi.fn(async () => [...db.packs.values()]),
      upsert: vi.fn(async ({ where, create }: { where: { skill: string }; create: Record<string, unknown> }) => db.packs.set(where.skill, { ...create })),
    },
  },
}));
vi.mock("@pm-collab/core/shared/secure-config", () => ({ sealText: (s: string) => `sealed:${s}`, openText: (s: string | null) => (s ? s.replace(/^sealed:/, "") : null) }));

import { mdToHtml } from "@pm-collab/core/delivery/blocks";
import { checkWikiSkill, setWikiToken, wikiAllowedPath, wikiVersion } from "@pm-collab/core/skills/wiki-updater";
import { resetSkillPacksForTest, skillFiles, skillVersions } from "@pm-collab/core/skills/store";

const SHA = "a".repeat(40);
const TOKEN = "github_pat_" + "x".repeat(50);
function gh(opts: { sha?: string; date?: string; status?: number } = {}) {
  const sha = opts.sha || SHA;
  return vi.fn(async (url: string) => {
    if (opts.status) return new Response("no", { status: opts.status });
    if (url.includes("/commits/")) return new Response(JSON.stringify({ sha, commit: { committer: { date: opts.date || "2026-12-01T08:30:00Z" } } }));
    if (url.includes("/git/trees/")) return new Response(JSON.stringify({ tree: [
      { path: "wiki-output-style/SKILL.md", type: "blob", size: 10 },
      { path: "wiki-output-style/references/components.md", type: "blob", size: 10 },
      { path: "wiki-output-style/assets/review-chart.png", type: "blob", size: 10 },
      { path: "wiki-output-style/.secret.md", type: "blob", size: 10 },
      { path: "README.md", type: "blob", size: 10 },
    ] }));
    if (url.includes("/contents/")) return new Response(`内容：${decodeURIComponent(url.split("/contents/")[1].split("?")[0])}`);
    return new Response("?", { status: 500 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  db.settings.clear();
  db.packs.clear();
  resetSkillPacksForTest();
});

describe("文档渲染用的 HTML", () => {
  it("mermaid 和公式保留语言、提示块变中性面板、普通引用不变", () => {
    const html = mdToHtml("```mermaid\nflowchart TD\n  A --> B\n```\n\n$$\n\\frac{9}{10}\n$$\n\n> **关键规则**\n>\n> 退回后由原提交人修改。\n\n> 普通引用");
    expect(html).toContain('<code class="language-mermaid">');
    expect(html).toContain('<code class="language-math">');
    expect(html).toContain('<div class="doc-panel" data-tone="neutral">');
    expect(html).toContain("<blockquote>");
  });
  it("清洗时不允许乱写的 class", () => {
    expect(mdToHtml('<pre><code class="language-x onload">a</code></pre>')).not.toContain("onload");
  });
});

describe("Wiki 输出规范在线更新", () => {
  it("路径过滤和版本号", () => {
    expect(wikiAllowedPath("wiki-output-style/references/components.md")).toBe("references/components.md");
    expect(wikiAllowedPath("wiki-output-style/assets/review-chart.png")).toBeNull();
    expect(wikiAllowedPath("wiki-output-style/../x.md")).toBeNull();
    expect(wikiAllowedPath("other/SKILL.md")).toBeNull();
    expect(wikiVersion("2026-12-01T08:30:00Z", SHA)).toBe("2026-12-01.0830-aaaaaaa");
  });
  it("没配令牌就跳过；令牌格式不对或没权限不保存", async () => {
    expect(await checkWikiSkill({ fetcher: gh() })).toEqual({ skipped: true });
    expect(await setWikiToken("abc", gh())).toMatchObject({ error: expect.stringContaining("不像") });
    expect(await setWikiToken(TOKEN, gh({ status: 404 }))).toMatchObject({ error: expect.stringContaining("权限") });
    expect(db.settings.has("wikiSkillToken")).toBe(false);
  });
  it("有新提交时下载 .md 并立即生效，同一提交不重复下载", async () => {
    expect(await setWikiToken(TOKEN, gh())).toEqual({ ok: true });
    expect(db.settings.get("wikiSkillToken")).toBe(`sealed:${TOKEN}`);
    const r = await checkWikiSkill({ fetcher: gh() });
    expect(r).toMatchObject({ updated: expect.stringContaining("2026-12-01.0830-aaaaaaa") });
    expect(skillVersions()["wiki-output-style"]).toBe("2026-12-01.0830-aaaaaaa");
    expect(skillFiles()["wiki-output-style/SKILL.md"]).toContain("wiki-output-style/SKILL.md");
    expect(skillFiles()["wiki-output-style/assets/review-chart.png"]).toBeUndefined();
    expect(Object.keys(skillFiles()).some((k) => k.includes(".secret"))).toBe(false);
    const f = gh();
    expect(await checkWikiSkill({ fetcher: f })).toEqual({ updated: null });
  });
  it("远端比打包版旧时不降级", async () => {
    await setWikiToken(TOKEN, gh());
    expect(await checkWikiSkill({ fetcher: gh({ sha: "b".repeat(40), date: "2020-01-01T00:00:00Z" }) })).toEqual({ updated: null });
  });
});
