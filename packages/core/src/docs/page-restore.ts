import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { extractRefs, sanitizeDocHtml } from "../shared/doc-html";
import { emptyBoard, sanitizeBoardScene } from "../shared/board";
import { casesJson, parseCasesBody } from "../shared/testcases";
import { logDoc, pageForWrite } from "../shared/docs-api";
import { bugWhere, getAccess, requirementWhere } from "../access";

/**
 * 恢复历史版本：把第 N 版的标题和正文发布成新的一版（版本号 +1），原有版本都保留，可以随时再恢复回来。
 * 未发布的草稿会被丢弃（前端确认时已提示）。
 */
export async function POST(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const body = input.body!;
  const from = Number(body.version);
  if (!Number.isInteger(from) || from < 1) return error("请选择要恢复的版本", 400);
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;
  if (page.deletedAt) return error("页面在回收站里，先恢复页面", 400);
  if (page.archivedAt) return error("页面已归档，先取消归档再恢复版本", 400);

  const source = await prisma.docPageVersion.findUnique({ where: { pageId_version: { pageId: page.id, version: from } } });
  if (!source) return error("这个版本不存在", 404);
  if (from === page.version) return error("这已经是当前版本", 400);

  const title = source.title;
  const html = page.kind === "board" ? sanitizeBoardScene(source.body) ?? emptyBoard() : page.kind === "testcases" ? casesJson(parseCasesBody(source.body)) : sanitizeDocHtml(source.body);
  const version = page.version + 1;

  // 和发布一样重建正文里的需求 / Bug 引用，只保留现在还存在、且操作人看得到的
  const refs = page.kind !== "doc" ? [] : extractRefs(html);
  const access = await getAccess(session);
  const [reqs, bugs] = await Promise.all([
    prisma.requirement.findMany({
      where: { id: { in: refs.filter((r) => r.kind === "req").map((r) => r.id) }, AND: [requirementWhere(access)] },
      select: { id: true },
    }),
    prisma.bug.findMany({ where: { id: { in: refs.filter((r) => r.kind === "bug").map((r) => r.id) }, AND: [bugWhere(access)] }, select: { id: true } }),
  ]);

  const now = new Date();
  await prisma.$transaction([
    prisma.docPage.update({
      where: { id: page.id },
      data: { title, body: html, draftTitle: null, draftBody: null, draftUpdatedAt: null, version, updatedById: session.id, publishedAt: now },
    }),
    prisma.docPageVersion.create({ data: { pageId: page.id, version, title, body: html, authorId: session.id } }),
    prisma.docPageLink.deleteMany({ where: { pageId: page.id, source: "body" } }),
    ...reqs.map((r) => prisma.docPageLink.create({ data: { pageId: page.id, requirementId: r.id, source: "body" } })),
    ...bugs.map((b) => prisma.docPageLink.create({ data: { pageId: page.id, bugId: b.id, source: "body" } })),
  ]);
  await logDoc(session.id, page.id, "restored", `恢复页面「${title}」到第 ${from} 版（生成第 ${version} 版）`, { version, from });
  return result({ id: page.id, spaceId: page.projectId, version });
}
