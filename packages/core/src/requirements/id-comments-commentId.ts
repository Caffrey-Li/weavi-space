import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { docPlainText, sanitizeDocHtml } from "../shared/doc-html";
import { linkAttachments } from "../shared/attachments";

async function load(params: { id: string; commentId: string }) {
  const c = await prisma.requirementComment.findUnique({ where: { id: params.commentId } });
  return c && c.requirementId === params.id ? c : null;
}

/** 只有作者能改自己的评论 */

export async function PATCH(session: SessionUser, params: { id: string; commentId: string }, body: Record<string, unknown>) {
  const html = sanitizeDocHtml(String(body.body || ""));
  if (!docPlainText(html) && !html.includes("<img")) return result({ error: "评论内容不能为空" }, { status: 400 });
  const c = await load(params);
  if (!c) return result({ error: "评论不存在" }, { status: 404 });
  if (c.authorId !== session.id) return result({ error: "只能编辑自己的评论" }, { status: 403 });
  const comment = await prisma.requirementComment.update({
    where: { id: c.id },
    data: { body: html },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
  await linkAttachments(c.id, html, "comment");
  return result({ comment });
}

export async function DELETE(session: SessionUser, params: { id: string; commentId: string }) {
  const c = await load(params);
  if (!c) return result({ error: "评论不存在" }, { status: 404 });
  if (c.authorId !== session.id && session.globalRole !== "admin") {
    return result({ error: "只能删除自己的评论" }, { status: 403 });
  }
  await prisma.requirementComment.delete({ where: { id: c.id } });
  return result({ ok: true });
}
