import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { storeArchImage, type readArchForm } from "./architecture-write";
import { prisma } from "@pm-collab/db/prisma";

export async function PATCH(session: SessionUser, params: { id: string; archId: string }, form: Awaited<ReturnType<typeof readArchForm>>) {
  if ("error" in form) return result({ error: form.error }, { status: 400 });
  if (form.fields.name === "") return result({ error: "请填写名称" }, { status: 400 });
  const arch = await prisma.productArchitecture.findFirst({ where: { id: params.archId, productId: params.id } });
  if (!arch) return result({ error: "架构图不存在" }, { status: 404 });
  const imageId = form.file ? await storeArchImage(arch.id, form.file, session.id) : undefined;
  await prisma.productArchitecture.update({ where: { id: arch.id }, data: { ...form.fields, updatedById: session.id, imageId } });
  if (imageId && arch.imageId) await prisma.attachment.deleteMany({ where: { id: arch.imageId, ownerType: "product_arch" } });
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: params.id, action: "updated", actorId: session.id, message: `更新了架构图「${form.fields.name ?? arch.name}」` },
  });
  return result({ ok: true });
}

export async function DELETE(session: SessionUser, params: { id: string; archId: string }) {
  const arch = await prisma.productArchitecture.findFirst({ where: { id: params.archId, productId: params.id } });
  if (!arch) return result({ error: "架构图不存在" }, { status: 404 });
  await prisma.productArchitecture.delete({ where: { id: arch.id } });
  await prisma.attachment.deleteMany({ where: { ownerType: "product_arch", ownerId: arch.id } });
  await prisma.activityLog.create({
    data: { entityType: "product", entityId: params.id, action: "updated", actorId: session.id, message: `删除了架构图「${arch.name}」` },
  });
  return result({ ok: true });
}
