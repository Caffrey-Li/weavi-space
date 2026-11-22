import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { requirementVisible } from "../access";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { result } from "../requirements/result";
import { MAX_CASES, casesJson, cleanCase, dedupeCodes, parseCasesBody } from "../shared/testcases";
import { parseImport } from "./case-import";

/**
 * 手动新建的用例页（T42，项目 · 测试 · 用例库「新建用例页」）：不属于任何需求交付，直接在用例页里增删改、导入。
 * 需求交付生成的用例页仍只能在交付面板里改（有确认 / 重新打开的流程），这里一律拒绝。
 */

async function editablePage(session: SessionUser, pageId: string) {
  const page = await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null } });
  if (!page || page.kind !== "testcases" || !(await canViewSpace(session, page.projectId))) return { ok: false as const, error: result({ error: "用例页不存在" }, { status: 404 }) };
  if (!(await canEditDocs(session, page.projectId))) return { ok: false as const, error: result({ error: "没有编辑这个空间文档的权限" }, { status: 403 }) };
  if (page.archivedAt) return { ok: false as const, error: result({ error: "用例页已归档" }, { status: 400 }) };
  if (await prisma.delivery.findFirst({ where: { casesPageId: page.id }, select: { id: true } })) return { ok: false as const, error: result({ error: "这是需求交付生成的用例，请在「需求交付」面板里修改" }, { status: 409 }) };
  return { ok: true as const, page };
}

async function publish(session: SessionUser, page: { id: string; title: string; version: number; revision: number }, body: string, note: string) {
  const version = page.version + 1;
  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.docPage.update({ where: { id: page.id, revision: page.revision }, data: { body, draftTitle: null, draftBody: null, draftUpdatedAt: null, version, updatedById: session.id, publishedAt: now } }),
      prisma.docPageVersion.create({ data: { pageId: page.id, version, title: page.title, body, authorId: session.id } }),
      prisma.activityLog.create({ data: { entityType: "doc", entityId: page.id, action: "updated", actorId: session.id, message: note } }),
    ]);
  } catch {
    return result({ error: "用例页刚被别人改过，刷新后再试" }, { status: 409 });
  }
  return result({ ok: true, version });
}

/** 新建用例页：{ title, requirementId? }；关联需求时同时挂到需求「资料 · 测试用例」 */
export async function createCasesPage(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const space = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, workspaceId: true } });
  if (!space || !(await canViewSpace(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (!(await canEditDocs(session, projectId))) return result({ error: "没有在这个项目写文档的权限" }, { status: 403 });
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || "测试用例";
  const reqId = body.requirementId ? String(body.requirementId) : null;
  const req = reqId && (await requirementVisible(session, reqId)) ? await prisma.requirement.findFirst({ where: { id: reqId, deletedAt: null }, select: { id: true, title: true } }) : null;
  if (reqId && !req) return result({ error: "需求不存在" }, { status: 404 });
  const max = await prisma.docPage.aggregate({ where: { projectId, parentId: null }, _max: { sortOrder: true } });
  const json = casesJson([]);
  const now = new Date();
  const page = await prisma.docPage.create({
    data: { projectId, title, kind: "testcases", body: json, version: 1, publishedAt: now, sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: session.id, updatedById: session.id, versions: { create: { version: 1, title, body: json, authorId: session.id } } },
    select: { id: true },
  });
  await prisma.activityLog.create({ data: { entityType: "doc", entityId: page.id, action: "created", actorId: session.id, message: `新建用例页：${title}` } });
  if (req) {
    await prisma.docPageLink.create({ data: { pageId: page.id, requirementId: req.id, source: "manual" } });
    await prisma.requirementArtifact.create({ data: { workspaceId: space.workspaceId, requirementId: req.id, kind: "testcases", source: "doc", title, docPageId: page.id, createdById: session.id } });
  }
  return result({ id: page.id, href: `/docs/${projectId}/pages/${page.id}` });
}

/** 增 / 改 / 删一条：{ code, case | null }（同需求交付的 saveCase） */
export async function savePageCase(session: SessionUser, pageId: string, body: Record<string, unknown>) {
  const e = await editablePage(session, pageId);
  if (!e.ok) return e.error;
  const cur = parseCasesBody(e.page.body);
  const code = String(body.code || "").toUpperCase();
  let next;
  if (!body.case) {
    if (!cur.some((c) => c.code === code)) return result({ error: "用例不存在" }, { status: 404 });
    next = cur.filter((c) => c.code !== code);
  } else {
    if (!code && cur.length >= MAX_CASES) return result({ error: `一个用例页最多 ${MAX_CASES} 条` }, { status: 400 });
    const c = cleanCase({ ...(body.case as object), code: code || undefined }, cur.length);
    if (!c) return result({ error: "请填写用例标题" }, { status: 400 });
    next = code && cur.some((x) => x.code === code) ? cur.map((x) => (x.code === code ? c : x)) : dedupeCodes([...cur, c]);
  }
  return publish(session, e.page, casesJson(next), code ? `修改用例 ${code}` : "新增用例");
}

/** 导入：{ text | fileBase64, fileName?, format?, mode: "append" | "replace" }；支持的格式见 case-import.ts */
export async function importPageCases(session: SessionUser, pageId: string, body: Record<string, unknown>) {
  const e = await editablePage(session, pageId);
  if (!e.ok) return e.error;
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > 2_000_000) return result({ error: "导入内容太大（上限 2 MB）" }, { status: 400 });
  const b64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
  if (b64.length > 7_000_000) return result({ error: "文件太大（上限 5 MB）" }, { status: 400 });
  const parsed = parseImport({ text, bytes: b64 ? new Uint8Array(Buffer.from(b64, "base64")) : undefined, fileName: String(body.fileName || ""), format: body.format ? String(body.format) : undefined });
  if (parsed.error) return result({ error: parsed.error }, { status: 400 });
  const incoming = parsed.cases;
  if (!incoming.length) return result({ error: "没有识别到用例（每条至少要有标题）" }, { status: 400 });
  const cur = body.mode === "replace" ? [] : parseCasesBody(e.page.body);
  // 追加时重新编号，避免和已有编号冲突
  const base = cur.length ? Math.max(...cur.map((c) => Number(c.code.slice(3)) || 0)) : 0;
  const add = body.mode === "replace" ? incoming : incoming.map((c, i) => ({ ...c, code: `TC-${String(base + i + 1).padStart(2, "0")}` }));
  const next = dedupeCodes([...cur, ...add]).slice(0, MAX_CASES);
  const r = await publish(session, e.page, casesJson(next), `导入用例 ${add.length} 条`);
  return r.init ? r : result({ ok: true, imported: Math.min(add.length, MAX_CASES - cur.length), total: next.length, format: parsed.format });
}
