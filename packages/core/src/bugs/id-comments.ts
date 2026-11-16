import type { SessionUser } from "../auth";
import type { ReferenceGuard } from "../open-api/refs";
import { result } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { docPlainText, sanitizeDocHtml } from "../shared/doc-html";
import { linkAttachments } from "../shared/attachments";
import { bugVisible } from "../access";

export async function GET(session: SessionUser, params: { id: string }) {
  if (!(await bugVisible(session, params.id))) return result({ error: "Bug 不存在" }, { status: 404 });
  const comments = await prisma.bugComment.findMany({
    where: { bugId: params.id },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return result({ comments });
}

export async function POST(session: SessionUser, params: { id: string }, body: Record<string, unknown>, guard?: ReferenceGuard) {
  const html = sanitizeDocHtml(String(body.body || ""));
  if (!docPlainText(html) && !html.includes("<img")) return result({ error: "备注内容不能为空" }, { status: 400 });
  const b = await prisma.bug.findFirst({ where: { id: params.id }, select: { id: true, archivedAt: true } });
  if (!b || !(await bugVisible(session, b.id))) return result({ error: "Bug 不存在" }, { status: 404 });
  if (b.archivedAt) return result({ error: "Bug 已归档，取消归档后才能添加备注" }, { status: 400 });
  if (guard && !(await guard({ body: body.body }))) return result({ error: "附件不存在" }, { status: 404 });
  const comment = await prisma.bugComment.create({
    data: { bugId: b.id, authorId: session.id, body: html },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
  await linkAttachments(comment.id, html, "comment");
  await prisma.bug.update({ where: { id: b.id }, data: { updatedAt: new Date() } });
  return result({ comment });
}
