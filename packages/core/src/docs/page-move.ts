import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { isDescendant } from "./docs-query";
import { logDoc, pageForWrite } from "../shared/docs-api";

/** 移动页面：{ parentId: string | null, groupId? }，放到新位置的末尾；移到根目录时可指定分组；只能在同一空间内移动 */
export async function POST(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const body = input.body!;
  const parentId = body.parentId ? String(body.parentId) : null;
  const groupId = !parentId && body.groupId ? String(body.groupId) : null;
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  const { page } = found;
  if (parentId) {
    const parent = await prisma.docPage.findUnique({ where: { id: parentId }, select: { projectId: true } });
    if (!parent || parent.projectId !== page.projectId) return error("目标页面不存在", 404);
    if (await isDescendant(page.id, parentId)) return error("不能移动到自己或自己的子页面下", 400);
  }
  if (groupId && !(await prisma.docGroup.findFirst({ where: { id: groupId, projectId: page.projectId } }))) return error("分组不存在", 404);
  const max = await prisma.docPage.aggregate({
    where: { projectId: page.projectId, parentId },
    _max: { sortOrder: true },
  });
  await prisma.docPage.update({
    where: { id: page.id },
    data: { parentId, groupId, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  await logDoc(session.id, page.id, "moved", "移动页面", { from: page.parentId, to: parentId, groupId });
  return result({ ok: true });
}
