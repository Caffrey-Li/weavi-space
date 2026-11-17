import { describe, expect, it, vi } from "vitest";

const state = { wikiStyle: true };
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ wikiStyle: state.wikiStyle })) },
    builtinSkillPack: { findMany: vi.fn(async () => []) },
  },
}));

import { BUGS, DOCS, PERSONAS, PRODUCTS, PROJECTS, RELEASES, REPORTS, REQUIREMENTS, REQ_COMMENTS, type NodeDef } from "@pm-collab/core/demo/data";
import { REQ_STATUS } from "@pm-collab/core/shared/constants";
import { wikiStyleFor, wikiStylePrompt } from "@pm-collab/core/skills/wiki-style";
import { mdToHtml } from "@pm-collab/core/delivery/blocks";

const names = (tree: NodeDef[]): string[] => tree.flatMap((n) => [n.name, ...names(n.children ?? [])]);
const persona = new Set(PERSONAS.map((p) => p.key));

describe("演示数据", () => {
  it("需求引用的产品、功能节点、父需求、人员都存在，状态是合法 key", () => {
    const statuses = new Set<string>(REQ_STATUS.map((s) => s.key));
    const seen = new Set<string>();
    for (const r of REQUIREMENTS) {
      const product = PRODUCTS.find((p) => p.key === r.product);
      expect(product, r.ref).toBeTruthy();
      expect(names(product!.tree), r.ref).toContain(r.node);
      if (r.project) expect(PROJECTS.some((p) => p.key === r.project), r.ref).toBe(true);
      if (r.parent) expect(seen.has(r.parent), `${r.ref} 的父需求要排在前面`).toBe(true);
      expect(statuses.has(r.status), r.ref).toBe(true);
      expect(["p0", "p1", "p2", "p3"]).toContain(r.priority);
      expect(persona.has(r.proposer)).toBe(true);
      for (const k of Object.values(r.people)) expect(persona.has(k!)).toBe(true);
      if (r.status === "online") expect(r.doneAt, r.ref).toBeDefined();
      expect(seen.has(r.ref), `重复的 ref ${r.ref}`).toBe(false);
      seen.add(r.ref);
    }
  });

  it("项目成员覆盖需求负责人，Bug、发版、文档、评论的引用都存在", () => {
    const refs = new Set(REQUIREMENTS.map((r) => r.ref));
    for (const r of REQUIREMENTS.filter((x) => x.project)) {
      const members = PROJECTS.find((p) => p.key === r.project)!.members;
      for (const k of Object.values(r.people)) expect(members, `${r.ref} 的负责人 ${k} 不是项目成员`).toContain(k);
    }
    for (const b of BUGS) {
      if (b.req) expect(refs.has(b.req), b.title).toBe(true);
      expect(["open", "in_progress", "resolved", "closed", "reopened", "cancelled"]).toContain(b.status);
      expect(["blocker", "critical", "major", "minor", "trivial"]).toContain(b.severity);
    }
    const versions = new Set<string>();
    for (const r of RELEASES) {
      for (const ref of r.reqs) expect(refs.has(ref), `${r.version} ${ref}`).toBe(true);
      for (const t of r.bugs ?? []) expect(BUGS.some((b) => b.title === t), t).toBe(true);
      if (r.kind === "hotfix") expect(r.reason).toBeTruthy();
      expect(versions.has(`${r.project}@${r.version}`)).toBe(false);
      versions.add(`${r.project}@${r.version}`);
    }
    const walk = (list: typeof DOCS[string]): void => list.forEach((d) => { if (d.primaryOf) expect(refs.has(d.primaryOf)).toBe(true); walk(d.children ?? []); });
    Object.values(DOCS).forEach(walk);
    for (const [ref] of REQ_COMMENTS) expect(refs.has(ref)).toBe(true);
    for (const key of Object.keys(REPORTS)) expect(PROJECTS.some((p) => p.key === key)).toBe(true);
  });

  it("文档正文能转成文档 HTML：流程图、公式、提示块都在", () => {
    const all = Object.values(DOCS).flat().flatMap((d) => [d, ...(d.children ?? [])]);
    const html = all.map((d) => mdToHtml(d.md)).join("");
    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain('class="language-math"');
    expect(html).toContain("doc-panel");
    expect(html).not.toMatch(/<h1[\s>]/);
  });
});

describe("个人 Wiki 排版开关", () => {
  it("关闭后不追加规范，开启时和全局规范一致", async () => {
    state.wikiStyle = true;
    expect(await wikiStyleFor("u1")).toBe(wikiStylePrompt());
    state.wikiStyle = false;
    expect(await wikiStyleFor("u1")).toBe("");
  });
});
