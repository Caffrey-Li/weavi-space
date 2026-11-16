import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { logDoc, pageForWrite } from "../shared/docs-api";
import { bugVisible, requirementVisible } from "../access";

/** 页头「关联需求」：{ kind: "req" | "bug", id } */
export async function POST(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const body = input.body!;
  const kind = body.kind === "bug" ? "bug" : body.kind === "req" ? "req" : null;
  const targetId = String(body.id || "");
  if (!kind || !targetId) return error("请选择要关联的需求或 Bug", 400);
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;

  const target =
    kind === "req"
      ? await prisma.requirement.findUnique({ where: { id: targetId }, select: { id: true, title: true } })
      : await prisma.bug.findUnique({ where: { id: targetId }, select: { id: true, title: true } });
  const visible = target && (kind === "req" ? await requirementVisible(session, targetId) : await bugVisible(session, targetId));
  if (!target || !visible) return error(kind === "req" ? "需求不存在" : "Bug 不存在", 404);

  const where = { pageId: params.id, source: "manual", ...(kind === "req" ? { requirementId: targetId } : { bugId: targetId }) };
  const exists = await prisma.docPageLink.findFirst({ where });
  const link =
    exists ??
    (await prisma.docPageLink.create({
      data: { pageId: params.id, source: "manual", ...(kind === "req" ? { requirementId: targetId } : { bugId: targetId }) },
    }));
  if (!exists) await logDoc(session.id, params.id, "linked", `关联${kind === "req" ? "需求" : " Bug"}：${target.title}`);
  return result({ id: link.id });
}

export async function DELETE(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const linkId = new URL(input.url).searchParams.get("linkId") || "";
  if (!linkId) return error("缺少 linkId", 400);
  const found = await pageForWrite(session, params.id);
  if ("error" in found) return found.error;
  await prisma.docPageLink.deleteMany({ where: { id: linkId, pageId: params.id, source: "manual" } });
  return result({ ok: true });
}
