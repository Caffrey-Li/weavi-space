import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { logDoc, pageForWrite } from "../shared/docs-api";
import { emptyBoard } from "../shared/board";

/**
 * 放弃草稿。从未发布过的新页面没有可回退的内容：没有子页面时直接删除，
 * 有子页面时保留为空页面。
 */
export async function DELETE(session: SessionUser, params: { id: string }) {
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;
  if (page.version === 0) {
    const children = await prisma.docPage.count({ where: { parentId: page.id } });
    if (children === 0) {
      await prisma.docPage.delete({ where: { id: page.id } });
      await logDoc(session.id, page.id, "discarded", `放弃新建页面：${page.draftTitle || page.title}`);
      return result({ deleted: true, spaceId: page.projectId, parentId: page.parentId });
    }
  }
  await prisma.docPage.update({
    where: { id: page.id },
    data: { draftTitle: null, draftBody: page.version === 0 ? (page.kind === "board" ? emptyBoard() : page.kind === "testcases" ? '{"cases":[]}' : "") : null, draftUpdatedAt: null },
  });
  return result({ deleted: false, spaceId: page.projectId });
}
