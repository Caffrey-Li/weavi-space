import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace, ancestorsOf, loadRefInfo } from "./docs-query";
import { extractRefs, renderDocHtml } from "../shared/doc-html";
export async function pageRead(session: SessionUser, id: string, pageId: string) {
 const page = await prisma.docPage.findUnique({
  where: { id: pageId }, include: { project: { select: { id: true, name: true, iconUrl: true } }, creator: { select: { name: true, avatarUrl: true } }, updatedBy: { select: { name: true, avatarUrl: true } }, links: { orderBy: { createdAt: "asc" } }, children: { where: { deletedAt: null, archivedAt: null }, select: { id: true, title: true, draftTitle: true, version: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, versions: { select: { author: { select: { name: true } } }, orderBy: { version: "desc" }, take: 30 } },
 });
 if (!page || page.projectId !== id || page.deletedAt) return {state:"notFound" as const};
 if (!(await canViewSpace(session, page.projectId))) return {state:"notFound" as const};
 const [canEdit, ancestors, star] = await Promise.all([
  canEditDocs(session, page.projectId), ancestorsOf(page.id), prisma.docPageStar.findUnique({ where: { pageId_userId: { pageId: page.id, userId: session.id } } }), prisma.docPage.update({ where: { id: page.id }, data: { viewCount: { increment: 1 }, }, select: { id: true } }),
 ]);
 if (page.kind === "board" || page.kind === "testcases") return {state:"ok" as const,page,canEdit,ancestors,star,bodyRefs:[] as {kind:"req"|"bug";id:string}[],linkRefs:[] as {kind:"req"|"bug";id:string}[],refInfo:await loadRefInfo([],session),html:"",toc:[] as ReturnType<typeof renderDocHtml>["toc"]};
 const bodyRefs=extractRefs(page.body); const linkRefs=page.links.map((l) => (l.requirementId ? {kind:"req" as const,id:l.requirementId} : {kind:"bug" as const,id:l.bugId!}));
 const refInfo=await loadRefInfo([...bodyRefs,...linkRefs],session); const rendered=renderDocHtml(page.body,refInfo);
 return {state:"ok" as const,page,canEdit,ancestors,star,bodyRefs,linkRefs,refInfo,...rendered};
}