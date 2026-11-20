import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { FeishuApiError, downloadMedia } from "../shared/feishu-api";
import { sanitizeDocHtml } from "../shared/doc-html";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { sniffImage } from "../shared/upload-guard";
import { linkAttachments } from "../shared/attachments";
import { listSourceDocs, parseDocUrl, readDocx } from "./feishu-docx";

export const IMPORT_AS = ["doc", "requirement", "bug"] as const;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 云文档：把飞书文档单向导入到本系统的文档空间（某个目录下）。
 * 只有能在目标空间编辑文档的人能建连接和同步；连接只对能看到该空间的人可见。
 * 再次同步时更新同一页面并发布一个新版本；系统里对这些页面的修改会被覆盖（页面上标明来源）。
 * T33：图片下载存成附件（挂在页面上，同一张图再次同步不重复下载）、表格转成表格；
 * 连接可选「导入成需求 / Bug」：每篇文档第一次导入时建一条，之后只更新文档页；「每天」自动同步由后台任务以创建人身份执行。
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
      importAs: l.importAs,
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
  const importAs = await checkImportAs(session, spaceId, body.importAs);
  if ("error" in importAs) return result({ error: importAs.error }, { status: importAs.status });
  const link = await prisma.cloudDocLink.create({
    data: { name: String(body.name || "").trim().slice(0, 60) || "飞书文档", url: String(body.url).trim().slice(0, 500), kind: ref.kind, token: ref.token, spaceId, parentPageId, autoSync: body.autoSync === "daily" ? "daily" : "off", importAs: importAs.value, createdById: session.id },
  });
  return result({ id: link.id });
}

/** 导入方式校验：建需求要有新建需求权限；建 Bug 只限项目空间（产品资料空间没有项目），并要有提 Bug 权限 */
async function checkImportAs(session: SessionUser, spaceId: string, raw: unknown): Promise<{ value: string } | { error: string; status: number }> {
  const value = (IMPORT_AS as readonly string[]).includes(String(raw)) ? String(raw) : "doc";
  if (value === "doc") return { value };
  const space = await prisma.project.findUnique({ where: { id: spaceId }, select: { status: true } });
  const isProduct = space?.status === "space";
  const { can } = await import("../permissions");
  if (value === "bug") {
    if (isProduct) return { error: "产品资料空间没有所属项目，不能导入成 Bug，请选项目空间", status: 400 };
    if (!(await can(session, "bugs.edit", spaceId))) return { error: "没有在这个项目提 Bug 的权限", status: 403 };
  } else if (!(await can(session, "requirements.create", isProduct ? undefined : spaceId))) return { error: "没有新建需求的权限", status: 403 };
  return { value };
}

/** 修改同步方式（每天自动同步、导入方式） */
export async function updateLink(session: SessionUser, id: string, body: Record<string, unknown>) {
  const l = await visibleLink(session, id);
  if (!l) return result({ error: "连接不存在" }, { status: 404 });
  if (!(await canEditDocs(session, l.spaceId))) return result({ error: "没有权限" }, { status: 403 });
  const data: { autoSync?: string; importAs?: string; name?: string } = {};
  if ("autoSync" in body) data.autoSync = body.autoSync === "daily" ? "daily" : "off";
  if ("name" in body) data.name = String(body.name || "").trim().slice(0, 60) || l.name;
  if ("importAs" in body) {
    const r = await checkImportAs(session, l.spaceId, body.importAs);
    if ("error" in r) return result({ error: r.error }, { status: r.status });
    data.importAs = r.value;
  }
  await prisma.cloudDocLink.update({ where: { id }, data });
  return result({ ok: true });
}

export async function deleteLink(session: SessionUser, id: string) {
  const l = await visibleLink(session, id);
  if (!l) return result({ error: "连接不存在" }, { status: 404 });
  if (!(await canEditDocs(session, l.spaceId))) return result({ error: "没有权限" }, { status: 403 });
  await prisma.cloudDocLink.delete({ where: { id } });
  return result({ ok: true });
}

/** 手动同步：本人身份 */
export async function syncLink(session: SessionUser, id: string) {
  const l = await visibleLink(session, id);
  if (!l) return result({ error: "连接不存在" }, { status: 404 });
  if (!(await canEditDocs(session, l.spaceId))) return result({ error: "没有在这个空间编辑文档的权限" }, { status: 403 });
  const r = await runSync(l, session, false);
  return "error" in r ? result({ error: r.error }, { status: 400 }) : result({ ok: true, ...r });
}

type LinkRow = NonNullable<Awaited<ReturnType<typeof prisma.cloudDocLink.findUnique>>>;

/** 图片：同一页面里同一个飞书图片只存一份附件（name 记来源 token） */
async function storeImage(token: string, pageId: string, uploaderId: string) {
  const name = `feishu-${token}`.slice(0, 200);
  const hit = await prisma.attachment.findFirst({ where: { ownerType: "doc", ownerId: pageId, name }, select: { id: true } });
  if (hit) return `/api/attachments/${hit.id}`;
  const file = await downloadMedia(token);
  const mime = sniffImage(file.data)?.mime; // 以内容为准，不信返回头
  if (!mime) throw new Error("不是支持的图片格式");
  if (file.data.length > 8 * 1024 * 1024) throw new Error("图片超过 8MB");
  const att = await prisma.attachment.create({ data: { ownerType: "doc", ownerId: pageId, name, mime, size: file.data.length, data: file.data, uploaderId }, select: { id: true } });
  return `/api/attachments/${att.id}`;
}

/** 执行同步：逐篇读取 → 清洗 → 新建或更新页面并发布 →（按导入方式）第一次时建需求 / Bug */
export async function runSync(l: LinkRow, actor: SessionUser, auto: boolean): Promise<{ created: number; updated: number; requirements: number; bugs: number; errors: string[]; at: string; by: string } | { error: string }> {
  let created = 0;
  let updated = 0;
  let requirements = 0;
  let bugs = 0;
  const errors: string[] = [];
  try {
    const docs = await listSourceDocs({ kind: l.kind as "docx" | "wiki" | "folder", token: l.token });
    for (const d of docs.slice(0, 100)) {
      try {
        const item = await prisma.cloudDocItem.findUnique({ where: { linkId_sourceToken: { linkId: l.id, sourceToken: d.token } } });
        let page = item ? await prisma.docPage.findFirst({ where: { id: item.pageId, deletedAt: null } }) : null;
        const isNew = !page;
        if (!page) {
          // 先建一个空页面拿到 id，图片附件挂在它上面
          const max = await prisma.docPage.aggregate({ where: { projectId: l.spaceId, parentId: l.parentPageId }, _max: { sortOrder: true } });
          page = await prisma.docPage.create({
            data: { projectId: l.spaceId, parentId: l.parentPageId, title: d.title?.slice(0, 200) || "飞书文档", body: "", version: 0, sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: actor.id, updatedById: actor.id },
          });
        }
        const pageId = page.id;
        let doc;
        try {
          doc = await readDocx(d.token, { image: (t) => storeImage(t, pageId, actor.id) });
        } catch (e) {
          if (isNew) await prisma.docPage.delete({ where: { id: pageId } }).catch(() => {});
          throw e;
        }
        errors.push(...doc.warnings.map((w) => `${doc.title}：${w}`));
        const html = sanitizeDocHtml(`<p><em>同步自飞书云文档，系统内修改会在下次同步时被覆盖。</em></p>\n${doc.html}`);
        const title = doc.title.slice(0, 200);
        const version = page.version + 1;
        await prisma.$transaction([
          prisma.docPage.update({ where: { id: pageId }, data: { title, body: html, version, publishedAt: new Date(), updatedById: actor.id, draftBody: null, draftTitle: null } }),
          prisma.docPageVersion.create({ data: { pageId, version, title, body: html, authorId: actor.id } }),
        ]);
        await linkAttachments(pageId, html, "doc");
        const it = await prisma.cloudDocItem.upsert({ where: { linkId_sourceToken: { linkId: l.id, sourceToken: d.token } }, create: { linkId: l.id, sourceToken: d.token, pageId }, update: { pageId, syncedAt: new Date() } });
        if (isNew) created++;
        else updated++;
        if (l.importAs === "requirement" && !it.requirementId) {
          const id = await createRequirementFor(actor, l.spaceId, pageId, title);
          if ("error" in id) errors.push(`${title}：建需求失败（${id.error}）`);
          else {
            await prisma.cloudDocItem.update({ where: { id: it.id }, data: { requirementId: id.id } });
            requirements++;
          }
        } else if (l.importAs === "bug" && !it.bugId) {
          const id = await createBugFor(actor, l.spaceId, pageId, title, html);
          if ("error" in id) errors.push(`${title}：建 Bug 失败（${id.error}）`);
          else {
            await prisma.cloudDocItem.update({ where: { id: it.id }, data: { bugId: id.id } });
            bugs++;
          }
        }
      } catch (e) {
        errors.push(e instanceof FeishuApiError ? e.message : e instanceof Error && e.message ? e.message : "读取失败");
      }
    }
  } catch (e) {
    const msg = e instanceof FeishuApiError ? e.message : "读取飞书目录失败";
    await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastSyncAt: new Date(), lastResult: JSON.stringify({ error: msg, auto }) } });
    return { error: msg };
  }
  const summary = { created, updated, requirements, bugs, errors: errors.slice(0, 5), at: new Date().toISOString(), by: actor.name, ...(auto ? { auto: true } : {}) };
  await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastSyncAt: new Date(), lastResult: JSON.stringify(summary) } });
  await prisma.activityLog.create({ data: { entityType: "cloud_doc", entityId: l.id, action: "synced", actorId: actor.id, toValue: JSON.stringify(summary) } });
  return summary;
}

/** 建需求：项目空间放到该项目，产品资料空间放公共池并挂产品；以导入的页面为主需求文档 */
async function createRequirementFor(actor: SessionUser, spaceId: string, pageId: string, title: string): Promise<{ id: string } | { error: string }> {
  const { POST } = await import("../requirements/root");
  const space = await prisma.project.findUnique({ where: { id: spaceId }, select: { status: true, productId: true } });
  const isProduct = space?.status === "space";
  const html = `<p>来自飞书云文档：<a href="/docs/${spaceId}/pages/${pageId}">${escapeHtml(title)}</a></p>`;
  const r = await POST(actor, { title, projectId: isProduct ? null : spaceId, ...(isProduct && space?.productId ? { productRefId: space.productId } : {}), priority: "p2", descriptionHtml: html });
  if (r.init?.status && r.init.status >= 400) return { error: String((r.body as { error?: string }).error || "创建失败") };
  const id = String((r.body as { id?: string }).id || "");
  if (!id) return { error: "创建失败" };
  await prisma.docPageLink.create({ data: { pageId, requirementId: id, source: "manual" } }).catch(() => {});
  await prisma.requirement.updateMany({ where: { id, docPageId: null }, data: { docPageId: pageId } });
  return { id };
}

/** 建 Bug：描述用文档正文（图片引用同一批附件，能看到项目的人都能看） */
async function createBugFor(actor: SessionUser, spaceId: string, pageId: string, title: string, html: string): Promise<{ id: string } | { error: string }> {
  const { POST } = await import("../bugs/index");
  const body = `${html}\n<p>来自飞书云文档：<a href="/docs/${spaceId}/pages/${pageId}">${escapeHtml(title)}</a></p>`;
  const r = await POST(actor, { title, projectId: spaceId, severity: "major", descriptionHtml: body });
  if (r.init?.status && r.init.status >= 400) return { error: String((r.body as { error?: string }).error || "创建失败") };
  const id = String((r.body as { id?: string }).id || "");
  return id ? { id } : { error: "创建失败" };
}

// ———————————————————— 每天自动同步 ————————————————————

const DAY = 24 * 3600_000;
let autoRunning = false;

/** 后台任务每小时调用：autoSync = daily 且距上次自动同步满 24 小时的连接，以创建人身份逐个执行 */
export async function runDueCloudDocSync(now = new Date()) {
  if (autoRunning) return 0;
  autoRunning = true;
  let n = 0;
  try {
    const links = await prisma.cloudDocLink.findMany({ where: { autoSync: "daily" }, orderBy: { lastAutoAt: "asc" } });
    for (const l of links) {
      if (l.lastAutoAt && now.getTime() - l.lastAutoAt.getTime() < DAY - 10 * 60_000) continue;
      const locked = await prisma.cloudDocLink.updateMany({ where: { id: l.id, lastAutoAt: l.lastAutoAt }, data: { lastAutoAt: now } });
      if (!locked.count) continue;
      const u = await prisma.user.findUnique({ where: { id: l.createdById }, select: { id: true, email: true, name: true, globalRole: true, avatarUrl: true, isActive: true, isDemo: true } });
      if (!u?.isActive || u.isDemo) {
        await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastResult: JSON.stringify({ error: "创建人已停用，自动同步已跳过", auto: true }) } });
        continue;
      }
      const owner: SessionUser = { id: u.id, email: u.email, name: u.name, globalRole: u.globalRole, avatarUrl: u.avatarUrl };
      if (!(await canViewSpace(owner, l.spaceId)) || !(await canEditDocs(owner, l.spaceId))) {
        await prisma.cloudDocLink.update({ where: { id: l.id }, data: { lastResult: JSON.stringify({ error: "创建人已没有这个空间的编辑权限，自动同步已跳过", auto: true }) } });
        continue;
      }
      try {
        const r = await runSync(l, owner, true);
        if (!("error" in r)) n++;
      } catch (e) {
        console.error(`[云文档] 自动同步「${l.name}」失败`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    autoRunning = false;
  }
  return n;
}
