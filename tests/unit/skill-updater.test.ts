import { beforeEach, describe, expect, it, vi } from "vitest";

/** 内置 skill 在线更新：路径过滤、版本比较、下载后生效、补充文件保留、失败记录、自动检查节奏 */
const db = vi.hoisted(() => ({ settings: new Map<string, string>(), packs: new Map<string, Record<string, unknown>>() }));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => db.settings.set(where.key, create.value)),
    },
    builtinSkillPack: {
      findMany: vi.fn(async () => [...db.packs.values()]),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => db.packs.set(String(create.skill), create)),
    },
  },
}));

import { allowedPath, autoUpdateTick, checkAndUpdate } from "@pm-collab/core/skills/updater";
import { compareVersion, resetSkillPacksForTest, skillFiles, skillVersions } from "@pm-collab/core/skills/store";

const SHA = "a".repeat(40);
function fakeGithub(version: string, extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "skills/caffrey-prd-plus/SKILL.md": "---\nname: caffrey-prd-plus\n---\n新版 PRD 说明",
    "skills/caffrey-prd-plus/VERSION": `${version}\n`,
    "skills/caffrey-prd-plus/references/prd-review.md": "检查 PRD",
    "skills/caffrey-prd-plus/scripts/make_bundle.py": "print(1)",
    "skills/caffrey-test-runner/SKILL.md": "---\nname: caffrey-test-runner\n---\n新版测试说明",
    "skills/caffrey-test-runner/VERSION": `${version}\n`,
    "skills/caffrey-test-runner/references/results.md": "上线结论",
    ...extra,
  };
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    const ok = (body: string) => new Response(body, { status: 200 });
    if (url.includes("/commits/")) return ok(JSON.stringify({ sha: SHA }));
    if (url.includes("/git/trees/")) return ok(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: "blob", size: files[path].length })) }));
    const m = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
    if (m && files[m[1]] !== undefined) return ok(files[m[1]]);
    return new Response("not found", { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

beforeEach(() => {
  db.settings.clear();
  db.packs.clear();
  resetSkillPacksForTest();
});

describe("路径和版本", () => {
  it("只收 skill 目录下的 .md / .ts / VERSION，不收 scripts、隐藏文件和越界路径", () => {
    expect(allowedPath("skills/caffrey-prd-plus/references/prd-review.md", "caffrey-prd-plus")).toBe("references/prd-review.md");
    expect(allowedPath("skills/caffrey-prd-plus/VERSION", "caffrey-prd-plus")).toBe("VERSION");
    expect(allowedPath("skills/caffrey-prd-plus/scripts/make_bundle.py", "caffrey-prd-plus")).toBeNull();
    expect(allowedPath("skills/caffrey-prd-plus/scripts/a.md", "caffrey-prd-plus")).toBeNull();
    expect(allowedPath("skills/caffrey-prd-plus/.secret.md", "caffrey-prd-plus")).toBeNull();
    expect(allowedPath("skills/caffrey-prd-plus/../x.md", "caffrey-prd-plus")).toBeNull();
    expect(allowedPath("skills/caffrey-test-runner/SKILL.md", "caffrey-prd-plus")).toBeNull();
    expect(allowedPath("skills/caffrey-prd-plus/a.sh", "caffrey-prd-plus")).toBeNull();
  });
  it("版本比较", () => {
    expect(compareVersion("0.12.1", "0.8.1")).toBe(1);
    expect(compareVersion("0.12.1", "0.12.1")).toBe(0);
    expect(compareVersion("1.0.0", "0.99.9")).toBe(1);
    expect(compareVersion("坏的", "0.1.0")).toBe(-1);
  });
});

describe("检查并更新", () => {
  it("远端更高：下载、存库、马上生效；scripts 不收；项目补充的文件仍在", async () => {
    const { f } = fakeGithub("99.0.0");
    const rec = await checkAndUpdate({ fetcher: f, by: "u1" });
    expect(rec.ok).toBe(true);
    expect(rec.updated).toHaveLength(2);
    expect(skillVersions()["caffrey-prd-plus"]).toBe("99.0.0");
    const files = skillFiles();
    expect(files["caffrey-prd-plus/SKILL.md"]).toContain("新版 PRD 说明");
    expect(files["caffrey-prd-plus/scripts/make_bundle.py"]).toBeUndefined();
    expect(files["caffrey-test-runner/references/weavi-delivery.md"]).toBeTruthy();
    expect(db.packs.get("caffrey-prd-plus")).toMatchObject({ version: "99.0.0", commit: SHA, updatedById: "u1" });
    expect(JSON.parse(db.settings.get("skillUpdateCheck")!)).toMatchObject({ ok: true });
  });
  it("远端不比当前新：只读版本号，不下载", async () => {
    const { f, calls } = fakeGithub("0.0.1");
    const rec = await checkAndUpdate({ fetcher: f });
    expect(rec.ok).toBe(true);
    expect(rec.updated).toEqual([]);
    expect(calls.every((u) => u.endsWith("/VERSION"))).toBe(true);
    expect(db.packs.size).toBe(0);
  });
  it("连不上 GitHub：记失败原因，继续用当前版本", async () => {
    const before = skillVersions()["caffrey-prd-plus"];
    const f = vi.fn(async () => {
      throw new Error("网络不可用");
    }) as unknown as typeof fetch;
    const rec = await checkAndUpdate({ fetcher: f });
    expect(rec).toMatchObject({ ok: false, error: "网络不可用" });
    expect(skillVersions()["caffrey-prd-plus"]).toBe(before);
  });
  it("下载的版本号不合法时不启用", async () => {
    const { f } = fakeGithub("99.0.0", { "skills/caffrey-prd-plus/VERSION": "最新" });
    const rec = await checkAndUpdate({ fetcher: f });
    expect(rec.ok).toBe(false);
    expect(db.packs.size).toBe(0);
  });
});

describe("自动检查节奏", () => {
  it("关掉自动更新不检查；24 小时内检查过不再检查", async () => {
    db.settings.set("skillAutoUpdate", "off");
    expect(await autoUpdateTick()).toBeNull();
    db.settings.set("skillAutoUpdate", "on");
    db.settings.set("skillUpdateCheck", JSON.stringify({ at: new Date().toISOString(), ok: true, error: null, latest: {}, updated: [] }));
    expect(await autoUpdateTick()).toBeNull();
  });
});
