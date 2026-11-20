import { NextResponse } from "next/server";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, productWhere, projectWhere } from "../access";
import { FeishuApiError, listBitableTables, listSheets, resolveTableLink } from "./feishu-api";
import {
  applyPull,
  applyPush,
  asAutoEvery,
  asAutoSync,
  asTarget,
  featureFor,
  fieldsFor,
  parseMappingFull,
  parsePushFields,
  serializeMapping,
  type RunResult,
} from "./feishu-table-sync";

export type LinkInput = {
  name?: string;
  url?: string;
  tableId?: string;
  headerRow?: number;
  target?: string;
  projectId?: string | null;
  productId?: string | null;
  mapping?: Record<string, string | string[]>;
  pushFields?: string[];
  appendOnPush?: boolean;
  autoTitle?: boolean;
  visibility?: string;
  autoSync?: string;
  autoEvery?: number;
};

type Viewer = { id: string; globalRole: string };

/** 校验并整理连接的输入；链接会解析出类型和 token。项目可不选（公共池），不选项目时可以只指定产品 */
export async function normalizeLink(body: LinkInput, viewer: Viewer) {
  const name = (body.name || "").trim();
  if (!name) throw new FeishuApiError("请填写连接名称");
  if (!body.url) throw new FeishuApiError("请粘贴表格链接");
  const target = asTarget(body.target);
  let projectId = "";
  let productId: string | null = null;
  if (body.projectId) {
    // 只认当前用户看得到的项目（T32）
    const project = await prisma.project.findFirst({ where: { id: body.projectId, AND: [projectWhere(await getAccess(viewer))] }, select: { id: true, status: true, productId: true } });
    if (!project || project.status === "space") throw new FeishuApiError("项目不存在");
    projectId = project.id;
    productId = project.productId; // 跟随项目的产品
  } else if (body.productId) {
    const ok = await prisma.product.count({ where: { id: body.productId, archivedAt: null, status: { not: "archived" }, AND: [productWhere(await getAccess(viewer))] } });
    if (!ok) throw new FeishuApiError("产品不存在或已归档");
    productId = body.productId;
  }
  const parsed = await resolveTableLink(body.url);
  const tableId = body.tableId || parsed.tableId;
  if (!tableId) throw new FeishuApiError("请选择工作表 / 数据表");
  const tables = parsed.kind === "sheet" ? await listSheets(parsed.token) : await listBitableTables(parsed.token);
  const table = tables.find((t) => t.id === tableId);
  if (!table) throw new FeishuApiError("表格里找不到这张工作表 / 数据表");
  // 只保留当前导入目标有的字段
  const allowed = new Set<string>(fieldsFor(target).map((f) => f.key));
  const rawMapping = Object.fromEntries(Object.entries(body.mapping || {}).filter(([k]) => allowed.has(k)));
  const mappingJson = serializeMapping({ ...rawMapping, _autoTitle: body.autoTitle === true });
  const full = parseMappingFull(mappingJson);
  if (!full.mapping.title) throw new FeishuApiError("请为「标题」选择对应的列");
  const autoSync = asAutoSync(body.autoSync);
  return {
    name: name.slice(0, 60),
    kind: parsed.kind,
    url: body.url.trim(),
    token: parsed.token,
    tableId,
    tableName: table.title,
    headerRow: Math.min(Math.max(Number(body.headerRow) || 0, 0), 50), // 0 = 自动识别
    target,
    projectId,
    productId,
    mapping: mappingJson,
    appendOnPush: body.appendOnPush === true,
    visibility: body.visibility === "public" ? "public" : "private",
    autoSync,
    autoEvery: asAutoEvery(body.autoEvery),
    // 只保留已对应了列的字段
    pushFields: JSON.stringify(
      parsePushFields(JSON.stringify(body.pushFields ?? ["status"]), full.multi).filter((k) => allowed.has(k) && full.mapping[k] && !(k === "title" && full.autoTitle)),
    ),
  };
}

export function apiError(e: unknown) {
  if (e instanceof FeishuApiError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("[飞书表格]", e);
  return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}

/** 自用连接只有创建人能看到和同步；公用连接所有人可见 */
export function canSeeLink(link: { visibility: string; createdById: string }, user: { id: string }) {
  return link.visibility === "public" || link.createdById === user.id;
}
/** 编辑 / 删除：创建人；公用连接管理员也可以 */
export function canEditLink(link: { visibility: string; createdById: string }, user: { id: string; globalRole?: string | null }) {
  return link.createdById === user.id || (link.visibility === "public" && user.globalRole === "admin");
}
/** 列表查询条件：公用 + 我自己的 */
export function visibleLinkWhere(user: { id: string }) {
  return { OR: [{ visibility: "public" }, { createdById: user.id }] };
}

/** 同步要的功能点（项目为空 = 公共池，按全局角色判断） */
export function canSyncLink(user: Viewer, link: { target: string; projectId: string }, pull: boolean) {
  return can(user, featureFor(asTarget(link.target), pull), link.projectId || null);
}

type LinkRow = { id: string; name: string };
/**
 * 执行一次拉取 / 回写，并记到连接（上次拉取 / 回写）和「最近同步记录」。手动和自动同步共用。
 * auto=true 时记录里注明「自动」。失败时也写一条记录再抛出。
 */
export async function runLinkSync(link: LinkRow, actor: { id: string; name: string }, pull: boolean, opts: { autoTitle?: boolean; auto?: boolean } = {}) {
  const verb = `${opts.auto ? "自动" : ""}${pull ? "拉取" : "回写"}`;
  try {
    const pullOpts = typeof opts.autoTitle === "boolean" ? { autoTitle: opts.autoTitle } : {};
    const res: RunResult = pull ? await applyPull(link.id, actor.id, pullOpts) : await applyPush(link.id);
    const now = new Date();
    const summary = { at: now.toISOString(), by: opts.auto ? `自动同步（${actor.name}）` : actor.name, auto: Boolean(opts.auto), ...res, errors: res.errors.slice(0, 20) };
    const parts = pull ? [`新增 ${res.created}`, `更新 ${res.updated}`] : [`更新 ${res.updated}`, `追加 ${res.appended}`];
    if (res.skipped) parts.push(`跳过 ${res.skipped}${res.errors[0] ? `（${res.errors[0]}）` : ""}`);
    else if (res.errors.length) parts.push(`提示 ${res.errors.length}（${res.errors[0]}）`);
    const message = `${verb} · ${link.name}　${parts.join(" · ")}`;
    await prisma.feishuTableLink.update({
      where: { id: link.id },
      data: pull ? { lastPullAt: now, lastPull: JSON.stringify(summary) } : { lastPushAt: now, lastPush: JSON.stringify(summary) },
    });
    await prisma.activityLog.create({
      data: { entityType: "feishu_table", entityId: link.id, action: "table_sync", actorId: actor.id, message, toValue: JSON.stringify({ direction: pull ? "pull" : "push", ...summary }) },
    });
    return { result: res, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "同步失败";
    await prisma.activityLog
      .create({
        data: {
          entityType: "feishu_table",
          entityId: link.id,
          action: "table_sync",
          actorId: actor.id,
          message: `${verb} · ${link.name}　失败（${msg}）`,
          toValue: JSON.stringify({ direction: pull ? "pull" : "push", auto: Boolean(opts.auto), error: true, errors: [msg] }),
        },
      })
      .catch(() => {});
    throw e;
  }
}
