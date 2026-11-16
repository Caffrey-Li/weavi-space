import type { SessionUser } from "../auth";
import type { ReferenceGuard } from "../open-api/refs";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { docPlainText, sanitizeDocHtml } from "../shared/doc-html";
import { linkAttachments } from "../shared/attachments";
import { requirementVisible } from "../access";

/** 需求评论：需求在自己的数据范围内才能查看和评论 */

export async function GET(session: SessionUser, params: { id: string }) {
  if (!(await requirementVisible(session, params.id))) return result({ error: "需求不存在" }, { status: 404 });
  const comments = await prisma.requirementComment.findMany({
    where: { requirementId: params.id },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return result({ comments });
}

export async function POST(session: SessionUser, params: { id: string }, body: Record<string, unknown>, guard?: ReferenceGuard) {
  const html = sanitizeDocHtml(String(body.body || ""));
  if (!docPlainText(html) && !html.includes("<img")) return result({ error: "评论内容不能为空" }, { status: 400 });
  const r = await prisma.requirement.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!r || !(await requirementVisible(session, r.id))) return result({ error: "需求不存在" }, { status: 404 });
  if (guard && !(await guard({ body: body.body }))) return result({ error: "附件不存在" }, { status: 404 });
  const comment = await prisma.requirementComment.create({
    data: { requirementId: r.id, authorId: session.id, body: html },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
  await linkAttachments(comment.id, html, "comment");
  await prisma.requirement.update({ where: { id: r.id }, data: { updatedAt: new Date() } });
  return result({ comment });
}
