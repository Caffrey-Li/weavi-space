import { format } from "date-fns";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { requirementVisible } from "../access";
import { canViewSpace } from "../docs/docs-query";
import { result } from "./result";
import { UPLOAD_MAX_BYTES, cleanFileName, fileMatchesType, sniffImage } from "../shared/upload-guard";
import {
  ARTIFACT_LABEL,
  ARTIFACT_MAX_PER_REQUIREMENT,
  type ArtifactItem,
  type ArtifactKind,
  type Completeness,
  cleanArtifactUrl,
  completenessOf,
  figmaEmbedUrl,
  isArtifactKind,
  linkSite,
  looksLikeHtml,
  sortArtifacts,
  titleFromUrl,
} from "../shared/artifacts-shared";

/**
 * 需求资料（T42）：UI 设计 / 原型 / 需求文档 / 测试用例 / 测试报告 / 其他。
 * - 手动挂的存 requirement_artifacts（线上地址、上传文件、系统里的文档页）；
 * - 主需求文档、PRD、用例页、每轮测试结果从需求交付自动带出，不重复存；
 * - 子需求自动显示父需求共享的资料和父需求的交付产物（标「来自父需求」）。
 * 看资料 = 能看需求；改资料 = 需求的「编辑」权限。
 */

const FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const day = (d: Date) => format(d, "MM-dd");
const docHref = (projectId: string, id: string) => `/docs/${projectId}/pages/${id}`;
export const artifactRawHref = (id: string) => `/api/artifact-raw/${id}`;

/** 交付产物：以这些文档为原始文档的需求交付（PRD、用例、每轮测试） */
async function deliveryItems(session: SessionUser, docIds: string[], inheritedDocs: Set<string>): Promise<ArtifactItem[]> {
  if (!docIds.length) return [];
  const out: ArtifactItem[] = [];
  const docs = await prisma.docPage.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true, title: true, projectId: true, version: true, updatedAt: true, creator: { select: { name: true } } } });
  const deliveries = await prisma.delivery.findMany({ where: { sourcePageId: { in: docIds } } });
  for (const doc of docs) {
    if (!(await canViewSpace(session, doc.projectId))) continue;
    const inherited = inheritedDocs.has(doc.id);
    out.push({ id: `auto:doc:${doc.id}`, kind: "doc", source: "auto", title: doc.title, meta: `主需求文档 · 第 ${doc.version} 版 · ${doc.creator.name}`, note: null, href: docHref(doc.projectId, doc.id), preview: false, badge: null, inherited, removable: false });
    const d = deliveries.find((x) => x.sourcePageId === doc.id);
    if (!d) continue;
    const pages = await prisma.docPage.findMany({ where: { id: { in: [d.prdPageId, d.casesPageId].filter((x): x is string => !!x) }, deletedAt: null }, select: { id: true, title: true, body: true, kind: true } });
    const prd = pages.find((p) => p.id === d.prdPageId);
    if (prd)
      out.push({ id: `auto:prd:${prd.id}`, kind: "doc", source: "auto", title: prd.title, meta: "需求交付 · PRD", note: null, href: docHref(d.projectId, prd.id), preview: false, badge: d.prdStatus === "confirmed" ? { label: `已确认 v${d.prdConfirmedVersion ?? ""}`, tone: "success" } : { label: "草稿", tone: "neutral" }, inherited, removable: false });
    const cases = pages.find((p) => p.id === d.casesPageId);
    if (cases) {
      let n = 0;
      try {
        n = (JSON.parse(cases.body || "{}").cases || []).length;
      } catch {
        n = 0;
      }
      out.push({ id: `auto:cases:${cases.id}`, kind: "testcases", source: "auto", title: `${cases.title}${n ? `（${n} 条）` : ""}`, meta: "需求交付 · 用例库可查", note: null, href: docHref(d.projectId, cases.id), preview: false, badge: d.casesStatus === "confirmed" ? { label: "已确认", tone: "success" } : { label: "草稿", tone: "neutral" }, inherited, removable: false });
    }
    // 每一轮正式测试（完成本轮后）当作一份测试报告；有 skill 生成的报告页就指向报告页
    const runs = await prisma.deliveryRun.findMany({ where: { deliveryId: d.id, kind: "round", status: "finalized" }, orderBy: { round: "desc" }, take: 5, include: { results: { select: { status: true, voided: true } } } });
    for (const r of runs) {
      const valid = r.results.filter((x) => !x.voided);
      const passed = valid.filter((x) => x.status === "passed").length;
      const failed = valid.filter((x) => x.status === "failed").length;
      const report = r.reportPageId ? await prisma.docPage.findFirst({ where: { id: r.reportPageId, deletedAt: null }, select: { id: true } }) : null;
      out.push({
        id: `auto:run:${r.id}`,
        kind: "report",
        source: "auto",
        title: `第 ${r.round} 轮测试${report ? "报告" : "结果"} · ${passed} / ${valid.length} 通过`,
        meta: `${r.executor === "local" ? "本机执行" : "服务器执行"} · ${day(r.finalizedAt || r.createdAt)}`,
        note: null,
        href: report ? docHref(d.projectId, report.id) : cases ? docHref(d.projectId, cases.id) : docHref(d.projectId, doc.id),
        preview: false,
        badge: failed ? { label: `${failed} 失败`, tone: "danger" } : passed === valid.length && valid.length ? { label: "通过", tone: "success" } : null,
        inherited,
        removable: false,
      });
    }
  }
  return out;
}

async function storedItems(session: SessionUser, reqIds: string[], parentId: string | null, selfId: string): Promise<ArtifactItem[]> {
  const rows = await prisma.requirementArtifact.findMany({
    where: { OR: [{ requirementId: { in: reqIds.filter((x) => x !== parentId) } }, ...(parentId ? [{ requirementId: parentId, shareToChildren: true }] : [])] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const name = (id: string) => users.find((u) => u.id === id)?.name || "—";
  const atts = await prisma.attachment.findMany({ where: { id: { in: rows.map((r) => r.attachmentId).filter((x): x is string => !!x) } }, select: { id: true, mime: true, size: true } });
  const pages = await prisma.docPage.findMany({ where: { id: { in: rows.map((r) => r.docPageId).filter((x): x is string => !!x) }, deletedAt: null }, select: { id: true, projectId: true, title: true } });
  const out: ArtifactItem[] = [];
  for (const r of rows) {
    const kind = (isArtifactKind(r.kind) ? r.kind : "other") as ArtifactKind;
    const inherited = r.requirementId !== selfId;
    const base = { id: r.id, kind, note: r.note, inherited, removable: !inherited, badge: r.note ? { label: r.note, tone: "neutral" as const } : null };
    if (r.source === "link" && r.url) {
      out.push({ ...base, source: "link", title: r.title, meta: `${linkSite(r.url)} · ${name(r.createdById)} · ${day(r.createdAt)}`, href: r.url, url: r.url, preview: kind === "ui" || kind === "prototype" ? true : !!figmaEmbedUrl(r.url) });
    } else if (r.source === "file" && r.attachmentId) {
      const a = atts.find((x) => x.id === r.attachmentId);
      if (!a) continue;
      const html = a.mime === "text/html";
      const img = a.mime.startsWith("image/");
      const size = a.size >= 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`;
      out.push({ ...base, source: "file", title: r.title, meta: `${html ? "HTML 文件 · 沙箱预览" : img ? "图片" : "文件"} · ${size} · ${name(r.createdById)} · ${day(r.createdAt)}`, href: html || img ? `/requirements/${selfId}/artifacts/${r.id}` : artifactRawHref(r.id), preview: html || img });
    } else if (r.source === "doc" && r.docPageId) {
      const p = pages.find((x) => x.id === r.docPageId);
      if (!p || !(await canViewSpace(session, p.projectId))) continue;
      out.push({ ...base, source: "doc", title: r.title || p.title, meta: `系统文档 · ${name(r.createdById)} · ${day(r.createdAt)}`, href: docHref(p.projectId, p.id), preview: false });
    }
  }
  // 预览类的标题统一指向资料预览页
  return out.map((x) => (x.preview && x.source === "link" ? { ...x, href: `/requirements/${selfId}/artifacts/${x.id}` } : x));
}

/** 一条需求的全部资料（手动 + 自动 + 来自父需求）；看不到的返回 null */
export async function listArtifacts(session: SessionUser, id: string) {
  if (!(await requirementVisible(session, id))) return null;
  const r = await prisma.requirement.findUnique({ where: { id }, select: { id: true, projectId: true, parentId: true, docPageId: true, deletedAt: true, parent: { select: { id: true, docPageId: true, deletedAt: true } } } });
  if (!r || r.deletedAt) return null;
  const parentId = r.parent && !r.parent.deletedAt ? r.parent.id : null;
  const docIds = [r.docPageId, parentId ? r.parent!.docPageId : null].filter((x): x is string => !!x);
  const inheritedDocs = new Set(parentId && r.parent!.docPageId && r.parent!.docPageId !== r.docPageId ? [r.parent!.docPageId] : []);
  const [stored, auto] = await Promise.all([storedItems(session, [r.id, ...(parentId ? [parentId] : [])], parentId, r.id), deliveryItems(session, [...new Set(docIds)], inheritedDocs)]);
  // 手动挂的系统文档如果就是主文档 / PRD，不重复显示
  const autoDocIds = new Set(auto.map((a) => a.id.split(":")[2]));
  const items = sortArtifacts([...auto, ...stored.filter((s) => !(s.source === "doc" && autoDocIds.has(s.href.split("/").pop() || "")))]);
  return { items, completeness: completenessOf(items), canEdit: await can(session, "requirements.edit", r.projectId) };
}

async function editable(session: SessionUser, id: string) {
  if (!(await requirementVisible(session, id))) return { ok: false as const, error: result({ error: "需求不存在" }, { status: 404 }) };
  const r = await prisma.requirement.findUnique({ where: { id }, select: { id: true, projectId: true, title: true, deletedAt: true, archivedAt: true, workspaceId: true } });
  if (!r || r.deletedAt) return { ok: false as const, error: result({ error: "需求不存在" }, { status: 404 }) };
  if (!(await can(session, "requirements.edit", r.projectId))) return { ok: false as const, error: result({ error: "没有编辑这条需求的权限" }, { status: 403 }) };
  if (r.archivedAt) return { ok: false as const, error: result({ error: "需求已归档，先取消归档再改资料" }, { status: 400 }) };
  const n = await prisma.requirementArtifact.count({ where: { requirementId: id } });
  if (n >= ARTIFACT_MAX_PER_REQUIREMENT) return { ok: false as const, error: result({ error: `每条需求最多 ${ARTIFACT_MAX_PER_REQUIREMENT} 份资料` }, { status: 400 }) };
  return { ok: true as const, r, n };
}

const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function log(actorId: string, reqId: string, message: string) {
  await prisma.activityLog.create({ data: { entityType: "requirement", entityId: reqId, action: "updated", actorId, message } });
}

/** 挂线上地址或系统文档：{ kind, source: "link" | "doc", url? / docPageId?, title?, note?, shareToChildren? } */
export async function createArtifact(session: SessionUser, id: string, body: Record<string, unknown>) {
  const kind = body.kind;
  if (!isArtifactKind(kind)) return result({ error: "请选择资料类型" }, { status: 400 });
  const source = body.source;
  if (source !== "link" && source !== "doc") return result({ error: "上传文件请用文件上传" }, { status: 400 });
  const e = await editable(session, id);
  if (!e.ok) return e.error;
  const note = cleanText(body.note, 40) || null;
  const share = body.shareToChildren !== false;
  if (source === "link") {
    const url = cleanArtifactUrl(body.url);
    if (!url) return result({ error: "地址要以 http:// 或 https:// 开头" }, { status: 400 });
    const title = cleanText(body.title, 120) || titleFromUrl(url) || linkSite(url);
    const a = await prisma.requirementArtifact.create({ data: { workspaceId: e.r.workspaceId, requirementId: id, kind, source, title, url, note, shareToChildren: share, sortOrder: e.n, createdById: session.id } });
    await log(session.id, id, `添加${ARTIFACT_LABEL[kind]}「${title}」`);
    return result({ id: a.id });
  }
  const pageId = cleanText(body.docPageId, 40);
  const p = pageId ? await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null }, select: { id: true, projectId: true, title: true } }) : null;
  if (!p || !(await canViewSpace(session, p.projectId))) return result({ error: "文档不存在" }, { status: 404 });
  if (await prisma.requirementArtifact.findFirst({ where: { requirementId: id, docPageId: p.id } })) return result({ error: "这篇文档已经挂在资料里了" }, { status: 409 });
  const title = cleanText(body.title, 120) || p.title;
  const a = await prisma.requirementArtifact.create({ data: { workspaceId: e.r.workspaceId, requirementId: id, kind, source, title, docPageId: p.id, note, shareToChildren: share, sortOrder: e.n, createdById: session.id } });
  if (!(await prisma.docPageLink.findFirst({ where: { pageId: p.id, requirementId: id } }))) await prisma.docPageLink.create({ data: { pageId: p.id, requirementId: id, source: "manual" } });
  await log(session.id, id, `添加${ARTIFACT_LABEL[kind]}「${title}」`);
  return result({ id: a.id });
}

/** 上传文件：原型可以是单个 HTML（只在沙箱里打开），其他资料是图片 / PDF / Office / ZIP / 文本，都 ≤ 5 MB */
export async function uploadArtifact(session: SessionUser, id: string, form: FormData) {
  const kind = form.get("kind");
  if (!isArtifactKind(kind)) return result({ error: "请选择资料类型" }, { status: 400 });
  const file = form.get("file");
  if (!file || typeof file === "string" || !file.size) return result({ error: "请选择要上传的文件" }, { status: 400 });
  if (file.size > UPLOAD_MAX_BYTES) return result({ error: "单个文件不能超过 5MB" }, { status: 400 });
  const e = await editable(session, id);
  if (!e.ok) return e.error;
  const data = Buffer.from(await file.arrayBuffer());
  const claimed = (file.type || "").toLowerCase();
  const lower = (file.name || "").toLowerCase();
  const image = sniffImage(data);
  let mime: string | null = image ? image.mime : null;
  if (!mime && (lower.endsWith(".html") || lower.endsWith(".htm") || claimed === "text/html")) mime = looksLikeHtml(data) ? "text/html" : null;
  if (!mime && FILE_TYPES.includes(claimed) && fileMatchesType(claimed, data)) mime = claimed;
  if (!mime) return result({ error: "不支持该文件类型，或文件内容与类型不符（原型请上传单个 .html 文件）" }, { status: 400 });
  const name = cleanFileName(file.name || "", "资料");
  const title = cleanText(form.get("title"), 120) || name;
  const note = cleanText(form.get("note"), 40) || null;
  const share = form.get("shareToChildren") !== "false";
  const a = await prisma.$transaction(async (tx) => {
    const art = await tx.requirementArtifact.create({ data: { workspaceId: e.r.workspaceId, requirementId: id, kind, source: "file", title, note, shareToChildren: share, sortOrder: e.n, createdById: session.id } });
    const att = await tx.attachment.create({ data: { ownerType: "artifact", ownerId: art.id, name, mime, size: data.length, data, uploaderId: session.id }, select: { id: true } });
    return tx.requirementArtifact.update({ where: { id: art.id }, data: { attachmentId: att.id } });
  });
  await log(session.id, id, `上传${ARTIFACT_LABEL[kind]}「${title}」`);
  return result({ id: a.id });
}

/** 改标题 / 版本说明 / 是否显示在子需求 */
export async function updateArtifact(session: SessionUser, id: string, artifactId: string, body: Record<string, unknown>) {
  const a = await prisma.requirementArtifact.findFirst({ where: { id: artifactId, requirementId: id } });
  if (!a || !(await requirementVisible(session, id))) return result({ error: "资料不存在" }, { status: 404 });
  const r = await prisma.requirement.findUnique({ where: { id }, select: { projectId: true } });
  if (!(await can(session, "requirements.edit", r?.projectId ?? null))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  const data: { title?: string; note?: string | null; shareToChildren?: boolean } = {};
  if (body.title !== undefined) {
    const t = cleanText(body.title, 120);
    if (!t) return result({ error: "标题不能为空" }, { status: 400 });
    data.title = t;
  }
  if (body.note !== undefined) data.note = cleanText(body.note, 40) || null;
  if (typeof body.shareToChildren === "boolean") data.shareToChildren = body.shareToChildren;
  await prisma.requirementArtifact.update({ where: { id: a.id }, data });
  return result({ ok: true });
}

export async function deleteArtifact(session: SessionUser, id: string, artifactId: string) {
  const a = await prisma.requirementArtifact.findFirst({ where: { id: artifactId, requirementId: id } });
  if (!a || !(await requirementVisible(session, id))) return result({ error: "资料不存在" }, { status: 404 });
  const r = await prisma.requirement.findUnique({ where: { id }, select: { projectId: true } });
  if (!(await can(session, "requirements.edit", r?.projectId ?? null))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  await prisma.$transaction([
    ...(a.attachmentId ? [prisma.attachment.deleteMany({ where: { id: a.attachmentId, ownerType: "artifact", ownerId: a.id } })] : []),
    prisma.requirementArtifact.delete({ where: { id: a.id } }),
  ]);
  const kind = (isArtifactKind(a.kind) ? a.kind : "other") as ArtifactKind;
  await log(session.id, id, `移除${ARTIFACT_LABEL[kind]}「${a.title}」`);
  return result({ ok: true });
}

/** 资料预览页用：这条资料（可以是父需求共享的）+ 同一需求里所有能预览的资料 */
export async function artifactForPreview(session: SessionUser, id: string, artifactId: string) {
  const list = await listArtifacts(session, id);
  if (!list) return null;
  const current = list.items.find((x) => x.id === artifactId && x.source !== "auto");
  if (!current) return null;
  const row = await prisma.requirementArtifact.findUnique({ where: { id: artifactId } });
  if (!row) return null;
  const att = row.attachmentId ? await prisma.attachment.findUnique({ where: { id: row.attachmentId }, select: { mime: true, name: true, size: true } }) : null;
  return {
    current,
    url: row.url,
    embed: row.url ? figmaEmbedUrl(row.url) : null,
    file: att ? { mime: att.mime, name: att.name, raw: artifactRawHref(row.id) } : null,
    tabs: list.items.filter((x) => x.preview || x.id === artifactId),
  };
}

/** 读文件内容（预览 / 下载）：看得到这条需求（或共享它的子需求的父需求）才能读 */
export async function artifactFile(session: SessionUser, artifactId: string) {
  const row = await prisma.requirementArtifact.findUnique({ where: { id: artifactId } });
  if (!row?.attachmentId || !(await requirementVisible(session, row.requirementId))) return null;
  return prisma.attachment.findFirst({ where: { id: row.attachmentId, ownerType: "artifact", ownerId: row.id } });
}

/** 一批需求的资料齐全度（发版详情用）：只看「有没有」，不展开内容 */
export async function artifactCompleteness(reqIds: string[]): Promise<Record<string, Completeness & { result: { passed: number; total: number; failed: number; round: number } | null }>> {
  if (!reqIds.length) return {};
  const reqs = await prisma.requirement.findMany({ where: { id: { in: reqIds } }, select: { id: true, parentId: true, docPageId: true, parent: { select: { docPageId: true } } } });
  const allIds = [...new Set([...reqIds, ...reqs.map((r) => r.parentId).filter((x): x is string => !!x)])];
  const stored = await prisma.requirementArtifact.findMany({ where: { requirementId: { in: allIds } }, select: { requirementId: true, kind: true, shareToChildren: true } });
  const docIds = [...new Set(reqs.flatMap((r) => [r.docPageId, r.parent?.docPageId]).filter((x): x is string => !!x))];
  const liveDocs = new Set((await prisma.docPage.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true } })).map((d) => d.id));
  const deliveries = await prisma.delivery.findMany({ where: { sourcePageId: { in: docIds } }, select: { id: true, sourcePageId: true, casesPageId: true, featureReqs: true } });
  const rounds = await prisma.deliveryRun.findMany({ where: { deliveryId: { in: deliveries.map((d) => d.id) }, kind: "round", status: "finalized" }, orderBy: { round: "desc" }, include: { results: { select: { status: true, voided: true } } } });
  const out: Record<string, Completeness & { result: { passed: number; total: number; failed: number; round: number } | null }> = {};
  for (const r of reqs) {
    const mine = stored.filter((s) => s.requirementId === r.id || (r.parentId && s.requirementId === r.parentId && s.shareToChildren));
    const kinds = new Set(mine.map((s) => s.kind));
    const docs = [r.docPageId, r.parent?.docPageId].filter((x): x is string => !!x && liveDocs.has(x));
    const ds = deliveries.filter((d) => docs.includes(d.sourcePageId));
    const run = rounds.find((x) => ds.some((d) => d.id === x.deliveryId));
    const valid = run ? run.results.filter((x) => !x.voided) : [];
    out[r.id] = {
      ui: kinds.has("ui"),
      prototype: kinds.has("prototype"),
      doc: kinds.has("doc") || docs.length > 0,
      testcases: kinds.has("testcases") || ds.some((d) => !!d.casesPageId),
      report: kinds.has("report") || !!run,
      result: run ? { passed: valid.filter((x) => x.status === "passed").length, failed: valid.filter((x) => x.status === "failed").length, total: valid.length, round: run.round } : null,
    };
  }
  return out;
}

/** 进度条「设计」阶段用：这条需求（或父需求共享的）有没有 UI 设计 / 原型 */
export async function hasDesign(id: string, parentId: string | null) {
  const n = await prisma.requirementArtifact.count({ where: { kind: { in: ["ui", "prototype"] }, OR: [{ requirementId: id }, ...(parentId ? [{ requirementId: parentId, shareToChildren: true }] : [])] } });
  return n > 0;
}
