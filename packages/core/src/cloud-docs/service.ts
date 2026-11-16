import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { FeishuApiError } from "../shared/feishu-api";
import { sanitizeDocHtml } from "../shared/doc-html";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { listSourceDocs, parseDocUrl, readDocx } from "./feishu-docx";

/**
 * 云文档：把飞书文档单向导入到本系统的文档空间（某个目录下）。
 * 只有能在目标空间编辑文档的人能建连接和同步；连接只对能看到该空间的人可见。
 * 再次同步时更新同一页面并发布一个新版本；系统里对这些页面的修改会被覆盖（页面上标明来源）。
 */
async function visibleLink(session: SessionUser, id: string) {
  const l = await prisma.cloudDocLink.findUnique({ where: { id } });
  if (!l || !(await canViewSpace(session, l.spaceId))) return null;
  return l;
}

export async function listLinks(session: SessionUser) {
  const links = await prisma.cloudDocLink.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } } });
  const out = [];
  for (const l of links) {
    if (!(await canViewSpace(session, l.spaceId))) continue;
    const [space, parent, owner] = await Promise.all([
      prisma.project.findUnique({ where: { id: l.spaceId }, select: { name: true } }),
      l.parentPageId ? prisma.docPage.findUnique({ where: { id: l.parentPageId }, select: { title: true } }) : Promise.resolve(null),
      prisma.user.findUnique({ where: { id: l.createdById }, select: { name: true } }),
    ]);
    out.push({
      id: l.id,
      provider: l.provider,
      name: l.name,
      url: l.url,
      kind: l.kind,
      spaceId: l.spaceId,
      spaceName: space?.name || "—",
      parentPageId: l.parentPageId,
      parentTitle: parent?.title || null,
      autoSync: l.autoSync,
      lastSyncAt: l.lastSyncAt?.toISOString() || null,
      lastResult: l.lastResult,
      pages: l._count.items,
      ownerName: owner?.name || "—",
      canEdit: await canEditDocs(session, l.spaceId),
    });
  }
  return result({ links: out });
}

export async function createLink(session: SessionUser, body: Record<string, unknown>) {
  const spaceId = String(body.spaceId || "");
  if (!spaceId || !(await canViewSpace(session, spaceId))) return result({ error: "文档空间不存在" }, { status: 404 });
  if (!(await canEditDocs(session, spaceId))) return result({ error: "没有在这个空间编辑文档的权限" }, { status: 403 });
  const parentPageId = body.parentPageId ? String(body.parentPageId) : null;
  if (parentPageId && !(await prisma.docPage.findFirst({ where: { id: parentPageId, projectId: spaceId } }))) return result({ error: "目标目录不存在" }, { status: 404 });
  let ref;
  try {
    ref = parseDocUrl(String(body.url || ""));
  } catch (e) {
    return result({ error: (e as Error).message }, { status: 400 });
  }
  const link = await prisma.cloudDocLink.create({
    data: { name: String(body.name || "").trim().slice(0, 60) || "飞书文档", url: String(body.url).trim().slice(0, 500), kind: ref.kind, token: ref.token, spaceId, parentPageId, autoSync: body.autoSync === "daily" ? "daily" : "off", createdById: session.id },
  });
  return result({ id: link.id });
}

export async function deleteLink(session: SessionUser, id: string) {
  const l = await visibleLink(session, id);
  if (!l) return result({ error: "连接不存在" }, { status: 404 });
  if (!(await canEditDocs(session, l.spaceId))) return result({ error: "没有权限" }, { status: 403 });
  await prisma.cloudDocLink.delete({ where: { id } });
  return result({ ok: true });
}

/** 执行同步：逐篇读取 → 清洗 → 新建或更新页面并发布 */
export async function syncLink(session: SessionUser, id: string) {
  const l = await visibleLink(session, id);
  if (!l) return result({ error: "连接不存在" }, { status: 404 });
  if (!(await canEditDocs(session, l.spaceId))) return result({ error: "没有在这个空间编辑文档的权限" }, { status: 403 });
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  try {
    const docs = await listSourceDocs({ kind: l.kind as "docx" | "wiki" | "folder", token: l.token });
    for (const d of docs.slice(0, 100)) {
      try {
        const doc = await readDocx(d.token);
        const html = sanitizeDocHtml(`<p><em>同步自飞书云文档，系统内修改会在下次同步时被覆盖。</em></p>\n${doc.html}`);
        const item = await prisma.cloudDocItem.findUnique({ where: { linkId_sourceToken: { linkId: l.id, sourceToken: d.token } } });
        const page = item ? await prisma.docPage.findFirst({ where: { id: item.pageId, deletedAt: null } }) : null;
        if (page) {
          const version = page.version + 1;
          await prisma.$transaction([
            prisma.docPage.update({ where: { id: page.id }, data: { title: doc.title.slice(0, 200), body: html, version, publishedAt: new Date(), updatedById: session.id, draftBody: null, draftTitle: null } }),
            prisma.docPageVersion.create({ data: { pageId: page.id, version, title: doc.title.slice(0, 200), body: html, authorId: session.id } }),
          ]);
          updated++;
        } else {
          const max = await prisma.docPage.aggregate({ where: { projectId: l.spaceId, parentId: l.parentPageId }, _max: { sortOrder: true } });
          const p = await prisma.docPage.create({
            data: { projectId: l.spaceId, parentId: l.parentPageId, title: doc.title.slice(0, 200), body: html, version: 1, publishedAt: new Date(), sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: session.id, updatedById: session.id },
          });
          await prisma.docPageVersion.create({ data: { pageId: p.id, version: 1, title: p.title, body: html, authorId: session.id } });
          await prisma.cloudDocItem.upsert({ where: { linkId_sourceToken: { linkId: l.id, sourceToken: d.token } }, create: { linkId: l.id, sourceToken: d.token, pageId: p.id }, update: { pageId: p.id, syncedAt: new Date() } });
          created++;
        }
      } catch (e) {
        errors.push(e instanceof FeishuApiError ? e.message : "读取失败");
      }
    }
  } catch (e) {
    const msg = e instanceof FeishuApiError ? e.message : "读取飞书目录失败";
    await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastSyncAt: new Date(), lastResult: JSON.stringify({ error: msg }) } });
    return result({ error: msg }, { status: 400 });
  }
  const summary = { created, updated, errors: errors.slice(0, 5), at: new Date().toISOString(), by: session.name };
  await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastSyncAt: new Date(), lastResult: JSON.stringify(summary) } });
  await prisma.activityLog.create({ data: { entityType: "cloud_doc", entityId: l.id, action: "synced", actorId: session.id, toValue: JSON.stringify(summary) } });
  return result({ ok: true, ...summary });
}
