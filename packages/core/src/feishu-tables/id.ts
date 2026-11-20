import type { SessionUser } from "../auth";
import { result } from "./result";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { FeishuApiError } from "../shared/feishu-api";
import { asTarget, featureFor } from "../shared/feishu-table-sync";
import { canEditLink, canSeeLink, normalizeLink, type LinkInput } from "../shared/feishu-table-links";

function serviceApiError(e: unknown) {
  if (e instanceof FeishuApiError) return result({ error: e.message }, { status: 400 });
  console.error("[飞书表格]", e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
}

/**
 * 写前可见性：不可见/跨企业按不存在 404；编辑权在解析 body 之前。
 * getBody 由适配器延迟传入，以保留原顺序。
 */
export async function PATCH(
  session: SessionUser,
  params: { id: string },
  getBody: () => Promise<LinkInput>,
) {
  const link = await prisma.feishuTableLink.findUnique({ where: { id: params.id } });
  if (!link || !canSeeLink(link, session)) return result({ error: "连接不存在" }, { status: 404 });
  if (!canEditLink(link, session)) return result({ error: "只有创建人可以编辑这个连接" }, { status: 403 });
  const body = await getBody();
  // 原范围和新范围都要有权限
  const nextProject = body.projectId === undefined ? link.projectId : body.projectId || null;
  if (nextProject && nextProject !== link.projectId && !(await canSeeProject(session, nextProject))) return result({ error: "项目不存在" }, { status: 404 });
  if (
    !(await can(session, featureFor(asTarget(link.target), true), link.projectId || null)) ||
    !(await can(session, featureFor(asTarget(body.target ?? link.target), true), nextProject || null))
  ) {
    return result({ error: "无权限" }, { status: 403 });
  }
  try {
    const data = await normalizeLink({ ...body, url: body.url || link.url }, session);
    if (data.autoSync === "push" && !link.lastPullAt) return result({ error: "首次同步需要先「从飞书拉取」，拉取过之后才能回写或设为自动回写" }, { status: 400 });
    // 换了表格或换了导入目标就清掉旧的行对应关系
    if (data.token !== link.token || data.tableId !== link.tableId || data.target !== asTarget(link.target)) {
      await prisma.feishuTableRow.deleteMany({ where: { linkId: link.id } });
    }
    // 改了自动同步方向或间隔：从现在起重新计时（开启时 lastAutoAt 为空会尽快执行一次）
    const autoChanged = data.autoSync !== link.autoSync || data.autoEvery !== link.autoEvery;
    await prisma.feishuTableLink.update({ where: { id: link.id }, data: { ...data, ...(autoChanged ? { lastAutoAt: null } : {}) } });
    return result({ ok: true });
  } catch (e) {
    return serviceApiError(e);
  }
}

export async function DELETE(session: SessionUser, params: { id: string }) {
  const link = await prisma.feishuTableLink.findUnique({ where: { id: params.id } });
  if (!link || !canSeeLink(link, session)) return result({ error: "连接不存在" }, { status: 404 });
  if (!canEditLink(link, session)) return result({ error: "只有创建人可以删除这个连接" }, { status: 403 });
  await prisma.feishuTableRow.deleteMany({ where: { linkId: link.id } });
  await prisma.feishuTableLink.delete({ where: { id: link.id } });
  return result({ ok: true });
}
