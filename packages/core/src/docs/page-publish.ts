import type { SessionUser } from "../auth";
import { result, error, conflictResult, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { extractRefs, sanitizeDocHtml } from "../shared/doc-html";
import { sanitizeBoardScene } from "../shared/board";
import { casesJson, sanitizeCases } from "../shared/testcases";
import { logDoc, pageForWrite } from "../shared/docs-api";
import { bugWhere, getAccess, requirementWhere } from "../access";
import { RevisionConflict, expectedRevision } from "../shared/optimistic";

/** 发布：草稿（或请求里带的最新内容）成为正式版本，版本号 +1，留一份历史 */
export async function POST(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const body = input.body!;
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;

  const title = String(body.title ?? page.draftTitle ?? page.title).trim().slice(0, 200);
  if (!title) return error("请填写页面标题", 400);
  const rawBody = body.body ?? page.draftBody ?? page.body;
  const cases = page.kind === "testcases" ? sanitizeCases(String(rawBody)) : null;
  const html = page.kind === "board" ? sanitizeBoardScene(rawBody) : page.kind === "testcases" ? (cases ? casesJson(cases.cases) : null) : sanitizeDocHtml(String(rawBody));
  if (html === null) return error(page.kind === "testcases" ? "用例内容格式不对" : "画布内容不合法或太大（上限 6 MB）", 400);
  const version = page.version + 1;

  // 正文里的需求 / Bug 引用：只保留真实存在、且发布人看得到的
  const refs = page.kind !== "doc" ? [] : extractRefs(html);
  const access = await getAccess(session);
  const [reqs, bugs] = await Promise.all([
    prisma.requirement.findMany({
      where: { id: { in: refs.filter((r) => r.kind === "req").map((r) => r.id) }, AND: [requirementWhere(access)] },
      select: { id: true },
    }),
    prisma.bug.findMany({ where: { id: { in: refs.filter((r) => r.kind === "bug").map((r) => r.id) }, AND: [bugWhere(access)] }, select: { id: true } }),
  ]);

  // 乐观锁：客户端带了 revision 且已过期（别人刚发布过）时拒绝，避免覆盖别人的发布
  const expected = expectedRevision(body);
  if (expected !== undefined && expected !== page.revision) return conflictResult(new RevisionConflict(page.revision));
  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.docPage.update({
        // 按读到的版本号写：读完之后有人发布过时 update 找不到记录，整个事务回滚（同版本号的 doc_page_versions 也有唯一约束兜底）
        where: { id: page.id, revision: page.revision },
        data: {
          title,
          body: html,
          draftTitle: null,
          draftBody: null,
          draftUpdatedAt: null,
          version,
          updatedById: session.id,
          publishedAt: now,
        },
      }),
      prisma.docPageVersion.create({ data: { pageId: page.id, version, title, body: html, authorId: session.id } }),
      prisma.docPageLink.deleteMany({ where: { pageId: page.id, source: "body" } }),
      ...reqs.map((r) => prisma.docPageLink.create({ data: { pageId: page.id, requirementId: r.id, source: "body" } })),
      ...bugs.map((b) => prisma.docPageLink.create({ data: { pageId: page.id, bugId: b.id, source: "body" } })),
    ]);
  } catch (e) {
    // P2025：按版本号找不到记录；P2002：同版本号的历史已存在。都说明刚被别人发布过
    const code = (e as { code?: string }).code;
    if (code === "P2025" || code === "P2002") return conflictResult(new RevisionConflict());
    throw e;
  }
  await logDoc(session.id, page.id, "published", `发布页面：${title}（第 ${version} 版）`, { version });
  return result({ id: page.id, spaceId: page.projectId, version, revision: page.revision + 1 });
}
