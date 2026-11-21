import { beforeEach, describe, expect, it, vi } from "vitest";

/** Wiki 输出规范：内置能力列出、存进文档空间时自动追加规范并按 Markdown 转文档、原型图不受影响 */
const calls = vi.hoisted(() => ({ prompts: [] as string[], pages: [] as { body: string }[], reply: "" }));
vi.mock("@pm-collab/core/skills/enterprise", () => ({ enterpriseOfUser: vi.fn(async () => ""), enterpriseSkills: vi.fn(async () => []), enterpriseOverride: vi.fn(async () => null) }));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    builtinSkillPack: { findMany: vi.fn(async () => []) },
    userSkill: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    docPage: { create: vi.fn(async ({ data }: { data: { body: string } }) => { calls.pages.push(data); return { id: "p1" }; }) },
    docPageVersion: { create: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => ({ wikiStyle: true })) },
  },
}));
vi.mock("@pm-collab/core/ai/providers", () => ({ chatLong: vi.fn(async (_c: unknown, _m: string, system: string) => { calls.prompts.push(system); return { text: calls.reply, inputTokens: 1, outputTokens: 1, truncated: false, continued: 0 }; }) }));
vi.mock("@pm-collab/core/ai/credentials", () => ({ credentialForUse: vi.fn(async () => ({ cred: { provider: "openai" }, enterpriseId: null, credentialId: "c", billedTo: "user" })) }));
vi.mock("@pm-collab/core/ai/quota", () => ({ recordUsage: vi.fn(async () => undefined) }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(async () => true), canEditDocs: vi.fn(async () => true) }));

import { listSkills, runSkill } from "@pm-collab/core/skills/service";
import { WIKI_TARGET, wikiStyleAvailable, wikiStylePrompt } from "@pm-collab/core/skills/wiki-style";
import { resetSkillPacksForTest } from "@pm-collab/core/skills/store";

const me = { id: "u1", globalRole: "member" } as never;
const run = (b: Record<string, unknown>) => runSkill(me, { input: "整理一下审核流程", credentialId: "c", model: "m", ...b }) as unknown as Promise<{ body: Record<string, unknown> }>;

beforeEach(() => {
  calls.prompts = [];
  calls.pages = [];
  calls.reply = "审核人只能处理分配给自己的申请。\n\n## 角色\n\n| 角色 | 操作 |\n| --- | --- |\n| 提交人 | 提交 |";
  resetSkillPacksForTest();
});

describe("Wiki 输出规范", () => {
  it("打包了 skill，提示词含 SKILL.md、组件选择和本系统的渲染能力", () => {
    expect(wikiStyleAvailable()).toBe(true);
    const p = wikiStylePrompt();
    expect(p).toContain("Wiki 输出规范");
    expect(p).toContain("组件选择与 Wiki 适配");
    expect(p).toContain(WIKI_TARGET);
  });
  it("内置能力里有「Wiki 排版」", async () => {
    const r = (await listSkills(me)) as unknown as { body: { builtin: { id: string; source: string }[] } };
    const w = r.body.builtin.find((b) => b.id === "builtin:wiki-format");
    expect(w?.source).toMatch(/^wiki-output-style v.+/);
  });
  it("存进文档空间时追加规范，并把 Markdown 表格转成文档表格", async () => {
    const r = await run({ skillId: "builtin:req-analysis", spaceId: "s1" });
    expect(r.body.pageId).toBe("p1");
    expect(calls.prompts[0]).toContain("排版要求（系统追加");
    expect(calls.pages[0].body).toContain("<table>");
    expect(calls.pages[0].body).toContain("<h2>");
  });
  it("不存文档时不追加；原型图存文档也不追加", async () => {
    await run({ skillId: "builtin:req-analysis" });
    expect(calls.prompts[0]).not.toContain("排版要求（系统追加");
    calls.reply = "<!doctype html><p>hi</p>";
    await run({ skillId: "builtin:prototype", spaceId: "s1" });
    expect(calls.prompts[1]).not.toContain("排版要求（系统追加");
    expect(calls.pages[0].body).toContain("<pre><code>");
  });
  it("Wiki 排版能力本身只追加本系统的渲染能力，不重复整份规范", async () => {
    await run({ skillId: "builtin:wiki-format", spaceId: "s1" });
    expect(calls.prompts[0]).toContain(WIKI_TARGET);
    expect(calls.prompts[0]).not.toContain("排版要求（系统追加");
    expect(calls.prompts[0]).toContain("Wiki 输出规范");
  });
});
