import { NextResponse } from "next/server";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { canEditDocs, canViewSpace } from "./docs";

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** 接口固定顺序里「查不到 404 → 权限 403」这一段：找页面并校验空间可见 / 可编辑 */
export async function pageForWrite(session: SessionUser, pageId: string, needEdit = true) {
  const page = await prisma.docPage.findUnique({ where: { id: pageId } });
  if (!page) return { error: jsonError("页面不存在或已删除", 404) } as const;
  if (!(await canViewSpace(session, page.projectId))) return { error: jsonError("无权查看该空间", 403) } as const;
  if (needEdit && !(await canEditDocs(session, page.projectId))) {
    return { error: jsonError("无权编辑该空间的文档", 403) } as const;
  }
  return { page } as const;
}

export async function logDoc(actorId: string, pageId: string, action: string, message: string, toValue?: unknown) {
  await prisma.activityLog.create({
    data: {
      entityType: "doc",
      entityId: pageId,
      action,
      actorId,
      message,
      toValue: toValue === undefined ? null : JSON.stringify(toValue),
    },
  });
}
