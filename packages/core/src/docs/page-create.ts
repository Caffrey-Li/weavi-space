import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace } from "./docs-query";
import { logDoc } from "../shared/docs-api";
import { BOARD_TEMPLATES, emptyBoard, type BoardTemplate } from "../shared/board";

/** 新建页面：先建一个未发布的草稿页，前端随即进入编辑 */
export async function POST(session: SessionUser, input: DocAccess = { url: "", body: null }) {
  const body = input.body!;
  const spaceId = String(body.spaceId || "");
  const parentId = body.parentId ? String(body.parentId) : null;
  const groupId = !parentId && body.groupId ? String(body.groupId) : null;
  const title = String(body.title || "").trim().slice(0, 200);
  if (!spaceId) return error("请选择空间", 400);
  const kind = body.kind === "board" ? "board" : "doc";
  const template = BOARD_TEMPLATES.includes(body.template as BoardTemplate) ? (body.template as BoardTemplate) : "blank";

  const space = await prisma.project.findUnique({ where: { id: spaceId }, select: { id: true } });
  // 看不到的空间和不存在一样（T32）
  if (!space || !(await canViewSpace(session, spaceId))) return error("空间不存在", 404);
  if (parentId) {
    const parent = await prisma.docPage.findUnique({ where: { id: parentId }, select: { projectId: true } });
    if (!parent || parent.projectId !== spaceId) return error("父页面不存在", 404);
  }
  if (!(await canEditDocs(session, spaceId))) {
    return error("无权在该空间新建页面", 403);
  }
  if (groupId && !(await prisma.docGroup.findFirst({ where: { id: groupId, projectId: spaceId } }))) return error("分组不存在", 404);

  const max = await prisma.docPage.aggregate({ where: { projectId: spaceId, parentId }, _max: { sortOrder: true } });
  const page = await prisma.docPage.create({
    data: {
      projectId: spaceId,
      parentId,
      groupId,
      title: title || (kind === "board" ? "无标题画布" : "无标题页面"),
      kind,
      body: kind === "board" ? emptyBoard() : "",
      draftTitle: title,
      draftBody: kind === "board" ? emptyBoard(template) : "",
      draftUpdatedAt: new Date(),
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      creatorId: session.id,
      updatedById: session.id,
    },
    select: { id: true, projectId: true },
  });
  await logDoc(session.id, page.id, "created", `${kind === "board" ? "新建画布" : "新建页面"}：${title || (kind === "board" ? "无标题画布" : "无标题页面")}`);
  return result(page);
}
