import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), user: vi.fn(), activity: vi.fn(), managed: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    userSkill: { findFirst: mock.findFirst, findUnique: mock.findUnique, findMany: mock.findMany, count: mock.count, create: mock.create, update: mock.update },
    user: { findUnique: mock.user, findMany: vi.fn(async () => []) },
    activityLog: { create: mock.activity },
  },
}));
vi.mock("@pm-collab/core/shared/org", async (orig) => ({
  ...(await orig<typeof import("@pm-collab/core/shared/org")>()),
  listOrgs: vi.fn(async () => [
    { id: "org_nova_collab", parentId: null, name: "系统", type: "system", sortOrder: 0 },
    { id: "entA", parentId: "org_nova_collab", name: "甲", type: "enterprise", sortOrder: 0 },
    { id: "deptA", parentId: "entA", name: "甲部门", type: "department", sortOrder: 0 },
    { id: "entB", parentId: "org_nova_collab", name: "乙", type: "enterprise", sortOrder: 0 },
  ]),
}));
vi.mock("@pm-collab/core/skills/store", () => ({
  refreshSkillPacks: vi.fn(async () => undefined),
  skillFiles: () => ({ "caffrey-prd-plus/SKILL.md": "内置 PRD 说明", "caffrey-test-runner/SKILL.md": "内置测试说明" }),
  skillVersions: () => ({ "caffrey-prd-plus": "1.0.0", "caffrey-test-runner": "1.0.0" }),
}));
vi.mock("@pm-collab/core/ai/credentials", () => ({ managedEnterprise: mock.managed, credentialForUse: vi.fn() }));

import { cleanSkillFiles, saveEnterpriseSkill, skillPrompt } from "@pm-collab/core/skills/service";

const member = { id: "m", email: "m@x", name: "成员", globalRole: "member" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.user.mockResolvedValue({ orgId: "deptA" });
});

describe("T35 参考文件校验", () => {
  it("接受正常文件", () => expect(cleanSkillFiles([{ path: "references/模板.md", content: "x" }])).toEqual({ files: [{ path: "references/模板.md", content: "x" }] }));
  it.each([["../etc/passwd"], ["a/../b.md"], ["SKILL.md"], ["a<b>.md"], [""]])("拒绝路径 %s", (path) => expect(cleanSkillFiles([{ path, content: "x" }])).toHaveProperty("error"));
  it("数量、大小、重名", () => {
    expect(cleanSkillFiles(Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.md`, content: "" })))).toHaveProperty("error");
    expect(cleanSkillFiles([{ path: "a.md", content: "x".repeat(100_001) }])).toHaveProperty("error");
    expect(cleanSkillFiles([{ path: "a.md", content: "1" }, { path: "a.md", content: "2" }])).toHaveProperty("error");
    expect(cleanSkillFiles(Array.from({ length: 4 }, (_, i) => ({ path: `f${i}.md`, content: "x".repeat(90_000) })))).toHaveProperty("error");
  });
});

describe("T35 定制内置能力", () => {
  it("没定制时用内置说明", async () => {
    mock.findFirst.mockResolvedValue(null);
    const p = await skillPrompt(member, "builtin:prd");
    expect(p?.prompt).toContain("内置 PRD 说明");
    expect(mock.findFirst).toHaveBeenCalledWith({ where: { scope: "enterprise", enterpriseId: "entA", overrides: "prd" } });
  });
  it("补充要求：内置说明后追加企业要求和参考文件", async () => {
    mock.findFirst.mockResolvedValue({ name: "PRD 生成", overrideMode: "append", content: "必须写灰度方案", files: [{ path: "references/企业模板.md", content: "模板正文" }] });
    const p = await skillPrompt(member, "builtin:prd", "交付任务");
    expect(p?.prompt).toContain("内置 PRD 说明");
    expect(p?.prompt).toContain("必须写灰度方案");
    expect(p?.prompt).toContain("企业参考文件：references/企业模板.md");
    expect(p?.prompt).toContain("交付任务");
  });
  it("替换：只用企业说明，不带内置原文", async () => {
    mock.findFirst.mockResolvedValue({ name: "企业 PRD", overrideMode: "replace", content: "企业 PRD 模板", files: null });
    const p = await skillPrompt(member, "builtin:prd");
    expect(p?.prompt).toContain("企业 PRD 模板");
    expect(p?.prompt).not.toContain("内置 PRD 说明");
  });
});

describe("T35 上传的 skill 的可见范围", () => {
  it("本企业的企业 skill 能用，带参考文件和任务", async () => {
    mock.findUnique.mockResolvedValue({ id: "s", scope: "enterprise", enterpriseId: "entA", overrides: null, userId: "admin", name: "评审清单", content: "清单", files: [{ path: "a.md", content: "附录" }] });
    const p = await skillPrompt(member, "s", "做评审");
    expect(p?.prompt).toContain("清单");
    expect(p?.prompt).toContain("===== 文件：a.md =====\n附录");
    expect(p?.prompt).toContain("本次任务：做评审");
  });
  it("别的企业的企业 skill、别人的个人 skill 都不能用", async () => {
    mock.findUnique.mockResolvedValueOnce({ id: "s", scope: "enterprise", enterpriseId: "entB", overrides: null, userId: "x", name: "乙", content: "乙", files: null });
    expect(await skillPrompt(member, "s")).toBeNull();
    mock.findUnique.mockResolvedValueOnce({ id: "s", scope: "user", enterpriseId: "", overrides: null, userId: "other", name: "别人", content: "c", files: null });
    expect(await skillPrompt(member, "s")).toBeNull();
  });
});

describe("T35 企业 skill 管理权限", () => {
  it("不是管理员不能保存", async () => {
    mock.managed.mockResolvedValue({ list: [], current: null });
    const r = await saveEnterpriseSkill(member, { scope: "entA", content: "企业 PRD 模板内容" });
    expect(r.init?.status).toBe(403);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("企业超管不能写别的企业", async () => {
    mock.managed.mockResolvedValue({ list: [{ id: "entA", name: "甲" }], current: { id: "entA", name: "甲" } });
    const r = await saveEnterpriseSkill(member, { scope: "entB", content: "企业 PRD 模板内容" });
    expect(r.init?.status).toBe(403);
  });
  it("同一个内置能力只能定制一次", async () => {
    mock.managed.mockResolvedValue({ list: [{ id: "entA", name: "甲" }], current: { id: "entA", name: "甲" } });
    mock.findFirst.mockResolvedValue({ id: "old" });
    const r = await saveEnterpriseSkill(member, { scope: "entA", content: "企业 PRD 模板内容", overrides: "prd" });
    expect(r.init?.status).toBe(409);
  });
  it("新增企业 skill 写入企业范围", async () => {
    mock.managed.mockResolvedValue({ list: [{ id: "entA", name: "甲" }], current: { id: "entA", name: "甲" } });
    mock.count.mockResolvedValue(0);
    mock.create.mockResolvedValue({ id: "new" });
    const r = await saveEnterpriseSkill(member, { scope: "entA", content: "---\nname: 评审清单\n---\n内容内容内容" });
    expect(r.body).toEqual({ id: "new" });
    expect(mock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ scope: "enterprise", enterpriseId: "entA", name: "评审清单", overrides: null }) });
  });
});
