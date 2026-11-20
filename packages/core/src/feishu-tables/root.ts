import type { SessionUser } from "../auth";
import { result } from "./result";
import { can } from "../permissions";
import { canSeeProject, getAccess } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { BUG_SYNC_FIELDS, MULTI_KEYS, SYNC_FIELDS, asAutoSync, asTarget, featureFor, parseMappingFull, parsePushFields, serializeMapping } from "../shared/feishu-table-sync";
import { FeishuApiError } from "../shared/feishu-api";
import { canEditLink, normalizeLink, visibleLinkWhere, type LinkInput } from "../shared/feishu-table-links";

const withMulti = (list: readonly { key: string; label: string; required?: boolean }[]) =>
  list.map((f) => ({ ...f, multi: (MULTI_KEYS as readonly string[]).includes(f.key) }));

function serviceApiError(e: unknown) {
  if (e instanceof FeishuApiError) return result({ error: e.message }, { status: 400 });
  console.error("[飞书表格]", e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
}

export async function GET(session: SessionUser) {
  const access = await getAccess(session);
  // 只给所属项目在数据范围内的人看；没有项目的（公共池）按可见范围
  const links = (await prisma.feishuTableLink.findMany({ where: visibleLinkWhere(session), orderBy: { createdAt: "asc" } })).filter(
    (l) => !l.projectId || access.projectIds === null || access.projectIds.includes(l.projectId),
  );
  const owners = await prisma.user.findMany({ where: { id: { in: Array.from(new Set(links.map((l) => l.createdById))) } }, select: { id: true, name: true } });
  const projects = await prisma.project.findMany({ where: { id: { in: links.map((l) => l.projectId).filter(Boolean) } }, select: { id: true, name: true, productId: true } });
  const productIds = Array.from(new Set([...links.map((l) => l.productId), ...projects.map((p) => p.productId)].filter((x): x is string => Boolean(x))));
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const runs = await prisma.activityLog.findMany({
    where: { entityType: "feishu_table", action: "table_sync", entityId: { in: links.map((l) => l.id) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { actor: { select: { name: true, avatarUrl: true } } },
  });
  return result({
    fields: withMulti(SYNC_FIELDS),
    bugFields: withMulti(BUG_SYNC_FIELDS),
    canManage: (await can(session, "requirements.create")) || (await can(session, "bugs.edit")),
    links: links.map((l) => {
      const project = l.projectId ? projects.find((p) => p.id === l.projectId) : null;
      const productId = project ? project.productId : l.productId;
      return {
        ...l,
        token: undefined, // 表格 token 不下发给浏览器
        target: asTarget(l.target),
        autoSync: asAutoSync(l.autoSync),
        mapping: Object.fromEntries(
          Object.entries(JSON.parse(serializeMapping(JSON.parse(l.mapping || "{}"))) as Record<string, string | string[]>).filter(([k]) => k !== "_autoTitle"),
        ),
        autoTitle: parseMappingFull(l.mapping).autoTitle,
        pushFields: parsePushFields(l.pushFields, parseMappingFull(l.mapping).multi).filter((k) => !(k === "title" && parseMappingFull(l.mapping).autoTitle)),
        projectName: l.projectId ? project?.name || "（项目已删除）" : null,
        productId: productId || null,
        productName: productId ? products.find((p) => p.id === productId)?.name || "（产品已删除）" : null,
        visibility: l.visibility === "public" ? "public" : "private",
        ownerName: owners.find((u) => u.id === l.createdById)?.name || "（已删除用户）",
        mine: l.createdById === session.id,
        canEdit: canEditLink(l, session),
        lastPull: l.lastPull ? JSON.parse(l.lastPull) : null,
        lastPush: l.lastPush ? JSON.parse(l.lastPush) : null,
      };
    }),
    runs: runs.map((r) => ({ id: r.id, at: r.createdAt, message: r.message, result: r.toValue ? JSON.parse(r.toValue) : null, actor: r.actor })),
  });
}

export async function POST(session: SessionUser, body: LinkInput) {
  const target = asTarget(body.target);
  if (body.projectId && !(await canSeeProject(session, String(body.projectId)))) return result({ error: "项目不存在" }, { status: 404 });
  if (!(await can(session, featureFor(target, true), body.projectId || null))) {
    return result({ error: target === "bug" ? "无权限：需要处理 Bug 的权限" : "无权限：需要新建需求的权限" }, { status: 403 });
  }
  try {
    const data = await normalizeLink(body, session);
    // 新连接还没拉取过：自动同步只能选「自动拉取」
    if (data.autoSync === "push") return result({ error: "首次同步需要先「从飞书拉取」，拉取过之后才能回写或设为自动回写" }, { status: 400 });
    const link = await prisma.feishuTableLink.create({ data: { ...data, createdById: session.id } });
    return result({ id: link.id });
  } catch (e) {
    return serviceApiError(e);
  }
}
