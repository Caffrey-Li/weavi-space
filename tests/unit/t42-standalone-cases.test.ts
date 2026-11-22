import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  docPage: { findFirst: vi.fn(), update: vi.fn() },
  delivery: { findFirst: vi.fn() },
  docPageVersion: { create: vi.fn() },
  activityLog: { create: vi.fn() },
  $transaction: vi.fn(async () => []),
}));
const perm = vi.hoisted(() => ({ view: true, edit: true }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn(async () => true) }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(async () => perm.view), canEditDocs: vi.fn(async () => perm.edit) }));

import { importPageCases, savePageCase } from "@pm-collab/core/delivery/standalone-cases";
import { parseImport as parseImportRaw, parseStepLine } from "@pm-collab/core/delivery/case-import";
const parseImport = (text: string) => parseImportRaw({ text });

const session = { id: "u1", globalRole: "member" } as never;

describe("T42 用例导入解析", () => {
  it("步骤写法同用例页显示", () => {
    expect(parseStepLine("1. 打开 /login")).toEqual({ action: "goto", target: "/login", value: "" });
    expect(parseStepLine("输入 账号「admin」")).toEqual({ action: "fill", target: "账号", value: "admin" });
    expect(parseStepLine("断言出现文字 欢迎")).toEqual({ action: "expectText", target: "欢迎", value: "" });
    expect(parseStepLine("让产品确认文案")).toEqual({ action: "note", target: "", value: "让产品确认文案" });
  });
  it("CSV：中文表头、带引号和换行的步骤", () => {
    const csv = '﻿编号,标题,功能点,优先级,执行方式,步骤,预期\nTC-01,登录成功,F-1,p0,自动,"打开 /login\n点击 登录",进入工作台\n,导出,,P2,手工,,\n';
    const r = parseImport(csv);
    expect(r.error).toBeUndefined();
    expect(r.cases).toHaveLength(2);
    expect(r.cases[0]).toMatchObject({ code: "TC-01", title: "登录成功", feature: "F-01", priority: "P0", mode: "auto" });
    expect(r.cases[0]!.steps).toHaveLength(2);
    expect(r.cases[1]!.mode).toBe("manual");
  });
  it("JSON 和错误提示", () => {
    expect(parseImport('{"cases":[{"title":"a"}]}').cases).toHaveLength(1);
    expect(parseImport("{bad").error).toBeTruthy();
    expect(parseImport("功能点\nF-01").error).toMatch(/标题/);
  });
});

describe("T42 手动用例页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perm.view = true;
    perm.edit = true;
    db.docPage.findFirst.mockResolvedValue({ id: "p1", projectId: "s1", kind: "testcases", title: "用例", body: '{"cases":[{"code":"TC-01","title":"a","steps":[]}]}', version: 1, revision: 0, archivedAt: null });
    db.delivery.findFirst.mockResolvedValue(null);
  });
  it("需求交付生成的用例页不能在这里改", async () => {
    db.delivery.findFirst.mockResolvedValue({ id: "d1" });
    expect((await savePageCase(session, "p1", { code: "", case: { title: "b" } })).init?.status).toBe(409);
  });
  it("看不到空间 404，没有编辑权限 403，普通文档 404", async () => {
    perm.view = false;
    expect((await savePageCase(session, "p1", { case: { title: "b" } })).init?.status).toBe(404);
    perm.view = true;
    perm.edit = false;
    expect((await savePageCase(session, "p1", { case: { title: "b" } })).init?.status).toBe(403);
    perm.edit = true;
    db.docPage.findFirst.mockResolvedValue({ id: "p1", projectId: "s1", kind: "doc" });
    expect((await savePageCase(session, "p1", { case: { title: "b" } })).init?.status).toBe(404);
  });
  it("新增用例发布新版本；追加导入重新编号", async () => {
    expect((await savePageCase(session, "p1", { code: "", case: { title: "b" } })).body).toMatchObject({ ok: true, version: 2 });
    const r = await importPageCases(session, "p1", { text: "标题\nx\ny", mode: "append" });
    expect(r.body).toMatchObject({ ok: true, imported: 2, total: 3 });
  });
});
