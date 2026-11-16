import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { FeishuApiError } from "../shared/feishu-api";
import { asTarget, previewPull, previewPush } from "../shared/feishu-table-sync";
import { canSeeLink, canSyncLink, runLinkSync } from "../shared/feishu-table-links";

function serviceApiError(e: unknown) {
  if (e instanceof FeishuApiError) return result({ error: e.message }, { status: 400 });
  console.error("[飞书表格]", e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
}

/**
 * POST { direction: "pull" | "push", apply?: boolean }
 * 不带 apply 只预览；apply=true 时重新计算并执行，记录到连接和「最近同步记录」
 * 可见性 404 在解析 body 与权限之前。
 */
export async function POST(
  session: SessionUser,
  params: { id: string },
  getBody: () => Promise<{ direction?: string; apply?: boolean; autoTitle?: boolean }>,
) {
  const link = await prisma.feishuTableLink.findUnique({ where: { id: params.id } });
  if (!link || !canSeeLink(link, session)) return result({ error: "连接不存在" }, { status: 404 });
  const body = await getBody();
  // 拉取时临时指定标题来源（不传则按连接设置）
  const opts = typeof body.autoTitle === "boolean" ? { autoTitle: body.autoTitle } : {};
  const pull = body.direction !== "push";
  // 数据同步首次一定是拉取：没拉取过的连接不能回写
  if (!pull && !link.lastPullAt) return result({ error: "首次同步需要先「从飞书拉取」，拉取过之后才能回写或设为自动回写" }, { status: 400 });
  if (!(await canSyncLink(session, link, pull))) {
    const bug = asTarget(link.target) === "bug";
    return result({ error: bug ? "无权限：需要处理 Bug 的权限" : pull ? "无权限：需要新建需求的权限" : "无权限：需要编辑需求的权限" }, { status: 403 });
  }
  try {
    if (!body.apply) return result(pull ? await previewPull(link.id, opts) : await previewPush(link.id));
    const { result: syncResult, message } = await runLinkSync(link, session, pull, opts);
    return result({ ok: true, result: syncResult, message });
  } catch (e) {
    return serviceApiError(e);
  }
}
