import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { LifecycleError, runAction } from "../shared/lifecycle";
import { prisma } from "@pm-collab/db/prisma";
import { sanitizeDocHtml } from "../shared/doc-html";
import { sanitizeBoardScene } from "../shared/board";
import { DOC_STATUS_TAGS } from "./docs-query";
import { logDoc, pageForWrite } from "../shared/docs-api";

/**
 * 自动保存草稿：{ title?, body?, statusTag? }
 * 草稿只有一份（Confluence 的共享草稿）；发布前阅读页仍显示已发布内容。
 */
export async function PATCH(session: SessionUser, params: { id: string }, input: DocAccess) {
  const body = input.body!;
  if (!body || typeof body !== "object") return error("请求格式不正确", 400);
  if (body.statusTag !== undefined && body.statusTag !== null && !DOC_STATUS_TAGS.some((t) => t.key === body.statusTag)) {
    return error("未知的页面状态", 400);
  }
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;

  const data: Record<string, unknown> = {};
  if (page.kind === "testcases" && body.body !== undefined) return error("测试用例请在用例表或需求交付面板里修改", 400);
  if (body.title !== undefined || body.body !== undefined) {
    data.draftTitle = body.title !== undefined ? String(body.title).slice(0, 200) : page.draftTitle ?? page.title;
    if (page.kind === "board") {
      const scene = body.body !== undefined ? sanitizeBoardScene(body.body) : page.draftBody ?? page.body;
      if (scene === null) return error("画布内容不合法或太大（上限 6 MB）", 400);
      data.draftBody = scene;
    } else {
      data.draftBody = body.body !== undefined ? sanitizeDocHtml(String(body.body)) : page.draftBody ?? page.body;
    }
    data.draftUpdatedAt = new Date();
  }
  if (body.statusTag !== undefined) data.statusTag = body.statusTag;
  const saved = await prisma.docPage.update({
    where: { id: page.id },
    data,
    select: { id: true, draftUpdatedAt: true, statusTag: true },
  });
  if (body.statusTag !== undefined && body.statusTag !== page.statusTag) {
    await logDoc(session.id, page.id, "status", "修改页面状态", { from: page.statusTag, to: body.statusTag });
  }
  return result(saved);
}

/** 删除页面（连同子页面）：移入回收站，30 天内可恢复 */
export async function DELETE(session: SessionUser, params: { id: string }) {
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;
  try {
    await runAction(session, "doc", page.id, "delete");
  } catch (e) {
    if (e instanceof LifecycleError) return error(e.message, 400);
    console.error("[删除文档]", e);
    return error("删除失败，请稍后重试", 500);
  }
  return result({ ok: true, spaceId: page.projectId, parentId: page.parentId });
}
