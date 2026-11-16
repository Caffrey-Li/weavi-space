import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { storeArchImage, type readArchForm } from "./architecture-write";
import { prisma } from "@pm-collab/db/prisma";

export async function POST(session: SessionUser, params: { id: string }, form: Awaited<ReturnType<typeof readArchForm>>) {
  if ("error" in form) return result({ error: form.error }, { status: 400 });
  if (!form.fields.name) return result({ error: "请填写名称" }, { status: 400 });
  const arch = await prisma.productArchitecture.create({
    data: {
      productId: params.id,
      type: form.fields.type ?? "custom",
      name: form.fields.name,
      description: form.fields.description ?? null,
      createdById: session.id,
      updatedById: session.id,
    },
  });
  if (form.file) {
    const imageId = await storeArchImage(arch.id, form.file, session.id);
    await prisma.productArchitecture.update({ where: { id: arch.id }, data: { imageId } });
  }
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: params.id, action: "updated", actorId: session.id, message: `新建了架构图「${arch.name}」` },
  });
  return result({ id: arch.id });
}
