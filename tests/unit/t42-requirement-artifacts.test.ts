import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  requirement: { findUnique: vi.fn(), findMany: vi.fn() },
  requirementArtifact: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  attachment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  docPage: { findFirst: vi.fn(), findMany: vi.fn() },
  docPageLink: { findFirst: vi.fn(), create: vi.fn() },
  delivery: { findMany: vi.fn() },
  deliveryRun: { findMany: vi.fn() },
  activityLog: { create: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const perm = vi.hoisted(() => ({ visible: true, edit: true, space: true }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: db }));
vi.mock("@pm-collab/core/access", () => ({ requirementVisible: vi.fn(async () => perm.visible) }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn(async () => perm.edit) }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(async () => perm.space) }));

import { artifactCompleteness, artifactFile, createArtifact, deleteArtifact, uploadArtifact } from "@pm-collab/core/requirements/artifacts";
import { cleanArtifactUrl, completenessOf, figmaEmbedUrl, linkSite, looksLikeHtml, missingRequired, sortArtifacts, titleFromUrl } from "@pm-collab/core/shared/artifacts-shared";

const session = { id: "u1", email: "a@x", name: "甲", globalRole: "member", avatarUrl: null } as never;

describe("T42 资料 · 纯函数", () => {
  it("只接受 http(s) 地址，拒绝带账号密码的", () => {
    expect(cleanArtifactUrl(" https://www.figma.com/design/abc/x ")).toBe("https://www.figma.com/design/abc/x");
    expect(cleanArtifactUrl("javascript:alert(1)")).toBeNull();
    expect(cleanArtifactUrl("data:text/html,hi")).toBeNull();
    expect(cleanArtifactUrl("https://u:p@evil.com")).toBeNull();
    expect(cleanArtifactUrl("")).toBeNull();
  });
  it("Figma 才能内嵌，其他网站不嵌", () => {
    expect(figmaEmbedUrl("https://www.figma.com/design/abc/导出报表?node-id=1-2")).toMatch(/^https:\/\/www\.figma\.com\/embed\?embed_host=weavi&url=/);
    expect(figmaEmbedUrl("https://evil.com/figma.com/design/x")).toBeNull();
    expect(figmaEmbedUrl("https://figma.com.evil.com/design/x")).toBeNull();
    expect(figmaEmbedUrl("http://www.figma.com/design/x")).toBeNull();
  });
  it("识别常见设计工具，标题取文件名", () => {
    expect(linkSite("https://mastergo.com/file/1")).toBe("MasterGo");
    expect(linkSite("https://www.figma.com/design/k/x")).toBe("Figma");
    expect(titleFromUrl("https://www.figma.com/design/key123/导出报表-v2?node-id=1")).toBe("导出报表 v2");
  });
  it("HTML 嗅探", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeHtml(enc("﻿<!DOCTYPE html><html></html>"))).toBe(true);
    expect(looksLikeHtml(enc("  <html lang='zh'>"))).toBe(true);
    expect(looksLikeHtml(enc("%PDF-1.4"))).toBe(false);
  });
  it("齐全度：文档 / 用例 / 报告必需，UI 原型可选；排序按类型", () => {
    const c = completenessOf([{ kind: "ui" }, { kind: "doc" }]);
    expect(c).toEqual({ ui: true, prototype: false, doc: true, testcases: false, report: false });
    expect(missingRequired(c)).toEqual(["testcases", "report"]);
    expect(sortArtifacts([{ kind: "report" as const }, { kind: "ui" as const }, { kind: "doc" as const }]).map((x) => x.kind)).toEqual(["ui", "doc", "report"]);
  });
});

describe("T42 资料 · 服务", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perm.visible = true;
    perm.edit = true;
    perm.space = true;
    db.requirement.findUnique.mockResolvedValue({ id: "r1", projectId: "p1", title: "导出", deletedAt: null, archivedAt: null, workspaceId: "ws_default" });
    db.requirementArtifact.count.mockResolvedValue(0);
    db.requirementArtifact.create.mockImplementation(async ({ data }) => ({ id: "a1", ...data }));
  });

  it("看不到需求按 404，没有编辑权限 403", async () => {
    perm.visible = false;
    expect((await createArtifact(session, "r1", { kind: "ui", source: "link", url: "https://www.figma.com/design/x/y" })).init?.status).toBe(404);
    perm.visible = true;
    perm.edit = false;
    expect((await createArtifact(session, "r1", { kind: "ui", source: "link", url: "https://www.figma.com/design/x/y" })).init?.status).toBe(403);
    expect(db.requirementArtifact.create).not.toHaveBeenCalled();
  });

  it("挂线上地址：标题默认取文件名，写动态", async () => {
    const r = await createArtifact(session, "r1", { kind: "ui", source: "link", url: "https://www.figma.com/design/k/视觉稿-v2", note: "v2 终稿" });
    expect(r.init).toBeUndefined();
    expect(db.requirementArtifact.create.mock.calls[0][0].data).toMatchObject({ kind: "ui", source: "link", title: "视觉稿 v2", note: "v2 终稿", requirementId: "r1" });
    expect(db.activityLog.create).toHaveBeenCalled();
  });

  it("拒绝非法类型、非法地址、上传走 JSON", async () => {
    expect((await createArtifact(session, "r1", { kind: "virus", source: "link", url: "https://a.com" })).init?.status).toBe(400);
    expect((await createArtifact(session, "r1", { kind: "ui", source: "link", url: "javascript:alert(1)" })).init?.status).toBe(400);
    expect((await createArtifact(session, "r1", { kind: "ui", source: "file" })).init?.status).toBe(400);
  });

  it("关联文档：看不到文档空间按 404；已挂过 409", async () => {
    db.docPage.findFirst.mockResolvedValue({ id: "d1", projectId: "p9", title: "设计说明" });
    perm.space = false;
    expect((await createArtifact(session, "r1", { kind: "doc", source: "doc", docPageId: "d1" })).init?.status).toBe(404);
    perm.space = true;
    db.requirementArtifact.findFirst.mockResolvedValue({ id: "a0" });
    expect((await createArtifact(session, "r1", { kind: "doc", source: "doc", docPageId: "d1" })).init?.status).toBe(409);
  });

  it("每条需求最多 50 份，归档的不能改", async () => {
    db.requirementArtifact.count.mockResolvedValue(50);
    expect((await createArtifact(session, "r1", { kind: "ui", source: "link", url: "https://a.com/x" })).init?.status).toBe(400);
    db.requirementArtifact.count.mockResolvedValue(0);
    db.requirement.findUnique.mockResolvedValue({ id: "r1", projectId: "p1", title: "导出", deletedAt: null, archivedAt: new Date(), workspaceId: "ws_default" });
    expect((await createArtifact(session, "r1", { kind: "ui", source: "link", url: "https://a.com/x" })).init?.status).toBe(400);
  });

  it("上传：HTML 原型按内容识别；伪装的可执行文件拒绝；超过 5MB 拒绝", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    db.attachment.create.mockResolvedValue({ id: "att1" });
    db.requirementArtifact.update.mockResolvedValue({ id: "a1" });
    const fd = (file: File) => {
      const f = new FormData();
      f.set("kind", "prototype");
      f.set("file", file);
      return f;
    };
    const ok = await uploadArtifact(session, "r1", fd(new File(["<!doctype html><html><body>hi</body></html>"], "proto.html", { type: "text/html" })));
    expect(ok.init).toBeUndefined();
    expect(db.attachment.create.mock.calls[0][0].data).toMatchObject({ ownerType: "artifact", ownerId: "a1", mime: "text/html" });
    expect((await uploadArtifact(session, "r1", fd(new File(["MZ\x90\x00"], "proto.html", { type: "text/html" })))).init?.status).toBe(400);
    expect((await uploadArtifact(session, "r1", fd(new File(["x"], "a.exe", { type: "application/x-msdownload" })))).init?.status).toBe(400);
    expect((await uploadArtifact(session, "r1", fd(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.html", { type: "text/html" })))).init?.status).toBe(400);
  });

  it("删除：只能删本需求下的资料，文件一起删", async () => {
    db.requirementArtifact.findFirst.mockResolvedValue(null);
    expect((await deleteArtifact(session, "r1", "other")).init?.status).toBe(404);
    db.requirementArtifact.findFirst.mockResolvedValue({ id: "a1", requirementId: "r1", attachmentId: "att1", kind: "prototype", title: "原型" });
    db.$transaction.mockResolvedValue([]);
    expect((await deleteArtifact(session, "r1", "a1")).init).toBeUndefined();
    expect(db.attachment.deleteMany).toHaveBeenCalledWith({ where: { id: "att1", ownerType: "artifact", ownerId: "a1" } });
  });

  it("读文件：看不到需求就读不到", async () => {
    db.requirementArtifact.findUnique.mockResolvedValue({ id: "a1", requirementId: "r1", attachmentId: "att1" });
    perm.visible = false;
    expect(await artifactFile(session, "a1")).toBeNull();
    perm.visible = true;
    db.attachment.findFirst.mockResolvedValue({ id: "att1", mime: "text/html" });
    expect(await artifactFile(session, "a1")).toMatchObject({ id: "att1" });
  });

  it("发版齐全度：子需求继承父需求共享的 UI 和交付产物", async () => {
    db.requirement.findMany.mockResolvedValue([{ id: "c1", parentId: "p1", docPageId: null, parent: { docPageId: "doc1" } }]);
    db.requirementArtifact.findMany.mockResolvedValue([{ requirementId: "p1", kind: "ui", shareToChildren: true }, { requirementId: "p1", kind: "prototype", shareToChildren: false }]);
    db.docPage.findMany.mockResolvedValue([{ id: "doc1" }]);
    db.delivery.findMany.mockResolvedValue([{ id: "d1", sourcePageId: "doc1", casesPageId: "cases1", featureReqs: {} }]);
    db.deliveryRun.findMany.mockResolvedValue([{ deliveryId: "d1", round: 2, results: [{ status: "passed", voided: false }, { status: "failed", voided: false }, { status: "failed", voided: true }] }]);
    const c = (await artifactCompleteness(["c1"])).c1;
    expect(c).toMatchObject({ ui: true, prototype: false, doc: true, testcases: true, report: true, result: { passed: 1, failed: 1, total: 2, round: 2 } });
  });
});
