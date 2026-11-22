import { prisma } from "@pm-collab/db/prisma";
import { bugVisible, canSeeProject, productVisible, requirementVisible } from "../access";
import type { SessionUser } from "../auth";

/** 正文里引用到的附件 id */
export function attachmentIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const re = /\/api\/attachments\/([a-z0-9]{6,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) ids.add(m[1]);
  return Array.from(ids);
}

/** 把还没有归属的附件（新建时先上传的配图）挂到这条记录上 */
export async function linkAttachments(ownerId: string, html: string | null | undefined, ownerType = "requirement") {
  const ids = attachmentIds(html);
  if (!ids.length) return;
  await prisma.attachment.updateMany({ where: { id: { in: ids }, ownerId: null }, data: { ownerId, ownerType } });
}

/** 附件的可见范围跟随它挂的对象；还没挂上去的（编辑中的草稿上传）只有上传者和系统管理员能读 */
export async function canReadAttachment(user: SessionUser, att: { ownerType: string; ownerId: string | null; uploaderId: string }) {
  if (user.globalRole === "admin" || att.uploaderId === user.id) return true;
  if (!att.ownerId) return false;
  const id = att.ownerId;
  switch (att.ownerType) {
    case "requirement":
      return requirementVisible(user, id);
    case "bug":
      return bugVisible(user, id);
    case "comment": {
      const c = await prisma.requirementComment.findUnique({ where: { id }, select: { requirementId: true } });
      return c ? requirementVisible(user, c.requirementId) : false;
    }
    case "product":
      return productVisible(user, id);
    case "delivery_run": {
      // 需求交付的失败截图：能看这个文档空间的人可以看；提成 Bug 后 Bug 描述里也引用它
      const r = await prisma.deliveryRun.findUnique({ where: { id }, select: { delivery: { select: { projectId: true } } } });
      if (!r) return false;
      const { canViewSpace } = await import("../docs/docs-query");
      return canViewSpace(user, r.delivery.projectId);
    }
    case "artifact": {
      // 需求资料（T42）：跟随资料所在的需求
      const a = await prisma.requirementArtifact.findUnique({ where: { id }, select: { requirementId: true } });
      return a ? requirementVisible(user, a.requirementId) : false;
    }
    case "product_arch": {
      const a = await prisma.productArchitecture.findUnique({ where: { id }, select: { productId: true } });
      return a ? productVisible(user, a.productId) : false;
    }
    case "doc": {
      const d = await prisma.docPage.findUnique({ where: { id }, select: { projectId: true } });
      return d ? canSeeProject(user, d.projectId) : false;
    }
    default:
      return false;
  }
}
