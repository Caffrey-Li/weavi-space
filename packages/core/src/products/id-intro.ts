import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { z } from "zod";
import { linkAttachments } from "../shared/attachments";
import { sanitizeDocHtml } from "../shared/doc-html";
import { prisma } from "@pm-collab/db/prisma";


const Body = z.object({ html: z.string().max(500_000, "内容太长，请精简后再保存") });
export async function PUT(session: SessionUser, params: { id: string }, body: unknown) {
  const parsed = Body.safeParse(body);
  if (!parsed.success) return result({ error: parsed.error.issues[0]?.message || "内容无效" }, { status: 400 });
  const html = sanitizeDocHtml(parsed.data.html);
  const data = { html, updatedById: session.id };
  const intro = await prisma.productIntro.upsert({ where: { productId: params.id }, create: { productId: params.id, ...data }, update: data });
  await linkAttachments(params.id, html, "product");
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: params.id, action: "updated", actorId: session.id, message: "更新了产品介绍" },
  });
  return result({ html: intro.html, updatedAt: intro.updatedAt, updatedBy: session.name });
}
