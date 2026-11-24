import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "./result";
import { can } from "../permissions";
import { getAccess, requirementVisible, userWhere } from "../access";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { escapeHtml, sanitizeDocHtml } from "../shared/doc-html";
import { reqStatusLabel } from "../shared/constants";
import { hasDesign } from "./artifacts";

/**
 * 需求全流程（T26）：一条业务需求 → 主需求文档 → PRD 确认后拆出的实现需求（子需求）→ 开发 → 测试 → 上线。
 * 这里算「需求进度」条（当前阶段、下一步、各处入口），以及「转化为需求文档」「关联 / 更换主文档」。
 */

/** T42 在「确认」和「开发」之间加了「设计」：有 UI 设计 / 原型、或已经进入开发就算过了这一步 */
export const FLOW_STAGES = ["提出", "需求文档", "确认", "设计", "开发", "测试", "上线"] as const;
const DEV = ["dev_todo", "dev_in_progress"];
const TESTING = ["dev_done", "test_todo", "test_in_progress"];
const OPEN_BUGS = ["open", "in_progress", "reopened"];

type Next = { label: string; href?: string; action?: "convert" };

/** 给定需求的进度条数据；看不到的返回 null */
export async function requirementFlow(session: SessionUser, id: string) {
  if (!(await requirementVisible(session, id))) return null;
  const r = await prisma.requirement.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, projectId: true, parentId: true, docPageId: true, project: { select: { id: true, name: true } }, children: { where: { deletedAt: null }, select: { id: true, status: true } } },
  });
  if (!r) return null;
  const doc = r.docPageId ? await prisma.docPage.findFirst({ where: { id: r.docPageId, deletedAt: null }, select: { id: true, title: true, projectId: true, version: true, updatedAt: true } }) : null;
  const docOk = doc && (await canViewSpace(session, doc.projectId)) ? doc : null;
  const delivery = docOk ? await prisma.delivery.findUnique({ where: { sourcePageId: docOk.id } }) : null;
  const [prd, cases] = await Promise.all([
    delivery?.prdPageId ? prisma.docPage.findFirst({ where: { id: delivery.prdPageId, deletedAt: null }, select: { id: true, title: true, version: true } }) : null,
    delivery?.casesPageId ? prisma.docPage.findFirst({ where: { id: delivery.casesPageId, deletedAt: null }, select: { id: true, title: true, version: true } }) : null,
  ]);
  const lastRound = delivery ? await prisma.deliveryRun.findFirst({ where: { deliveryId: delivery.id, kind: "round", status: "finalized" }, include: { results: { select: { status: true, voided: true } } }, orderBy: { round: "desc" } }) : null;
  const testPassed = !!lastRound && lastRound.results.every((x) => x.voided || x.status === "passed");
  // 引用了这条需求的其他文档（正文引用或手动关联）
  const links = await prisma.docPageLink.findMany({ where: { requirementId: r.id, page: { deletedAt: null, archivedAt: null } }, select: { page: { select: { id: true, title: true, projectId: true } } }, take: 20 });
  const others: { id: string; title: string; projectId: string }[] = [];
  for (const l of links) if (l.page.id !== docOk?.id && l.page.id !== prd?.id && l.page.id !== cases?.id && !others.some((o) => o.id === l.page.id) && (await canViewSpace(session, l.page.projectId))) others.push(l.page);
  const ids = [r.id, ...r.children.map((c) => c.id)];
  const openBugs = await prisma.bug.count({ where: { requirementId: { in: ids }, status: { in: OPEN_BUGS }, deletedAt: null } });
  const kids = r.children;
  const kidCount = (keys: string[]) => kids.filter((k) => keys.includes(k.status)).length;
  const docHref = docOk ? `/docs/${docOk.projectId}/pages/${docOk.id}` : null;
  const prdHref = prd && docOk ? `/docs/${docOk.projectId}/pages/${prd.id}` : null;
  const casesHref = cases && docOk ? `/docs/${docOk.projectId}/pages/${cases.id}` : null;
  const board = r.projectId ? `/projects/${r.projectId}/board` : "/requirements";
  const releases = r.projectId ? `/projects/${r.projectId}/releases` : null;
  const designed = await hasDesign(r.id, r.parentId);

  let stage = 0;
  let next: Next | null = null;
  let hint = "";
  if (r.status === "online" && (!kids.length || kids.every((k) => k.status === "online" || k.status === "cancelled"))) {
    stage = 7;
    hint = "已上线，流程走完了。";
  } else if (r.status === "cancelled") {
    stage = 0;
    hint = "这条需求已取消。";
  } else if (!docOk) {
    stage = r.status.startsWith("req") ? 0 : r.status.startsWith("dev") ? 4 : r.status.startsWith("test") ? 5 : 0;
    next = { label: "转化为需求文档", action: "convert" };
    hint = "下一步：把这条需求转化为需求文档，补齐背景、范围和验收标准后生成 PRD。";
  } else if (!delivery || delivery.prdStatus === "none" || delivery.prdStatus === "failed" || delivery.prdStatus === "generating") {
    stage = 1;
    next = { label: "打开需求文档", href: docHref! };
    hint = delivery?.prdStatus === "generating" ? "PRD 正在生成，生成后在需求文档里确认。" : "下一步：在需求文档右上角点「需求交付」，生成 PRD。";
  } else if (delivery.prdStatus === "draft") {
    stage = 2;
    next = { label: "去确认 PRD", href: prdHref || docHref! };
    hint = "下一步：在 PRD 里和小围对话把问题改完，点「确认 PRD」。确认时会拆出实现需求。";
  } else if (!designed && r.status.startsWith("req") && kidCount(["req_in_progress", "req_done", "cancelled"]) === kids.length) {
    stage = 3;
    next = { label: "添加 UI 设计", href: "#rq-artifacts" };
    hint = "下一步：在下方「资料」里挂上 UI 设计稿或原型（Figma、MasterGo 等线上地址，或上传 HTML 原型）。不需要设计的需求，直接把状态改到「待开发」。";
  } else if (kids.length && kidCount(DEV) + kidCount(["req_in_progress", "req_done"]) > 0) {
    stage = 4;
    next = { label: "去看板", href: board };
    hint = `下一步：实现需求 ${kids.length} 条，已开发完成 ${kids.length - kidCount(DEV) - kidCount(["req_in_progress", "req_done"])} 条。全部开发完成后，到需求文档的「需求交付」里发起测试。`;
  } else if (!testPassed) {
    stage = 5;
    next = { label: delivery.casesStatus === "none" ? "去生成测试用例" : "去测试", href: casesHref || prdHref || docHref! };
    hint = delivery.casesStatus !== "confirmed" ? "下一步：在需求交付里生成并确认测试用例，然后发起测试。" : openBugs ? `下一步：还有 ${openBugs} 个 Bug 没解决，修好后提交回归。` : "下一步：在需求交付里发起测试（或提交回归）。";
  } else {
    stage = 6;
    next = releases ? { label: "去发版", href: releases } : null;
    hint = kids.length ? `测试已通过。下一步：把实现需求加入发版并上线（已上线 ${kidCount(["online"])} / ${kids.length}）。` : "测试已通过。下一步：加入发版并上线。";
  }
  return {
    stage,
    stages: FLOW_STAGES,
    next,
    hint,
    canConvert: !docOk && (await can(session, "requirements.edit", r.projectId)),
    doc: docOk ? { id: docOk.id, title: docOk.title, href: docHref!, version: docOk.version } : null,
    prd: prd ? { id: prd.id, title: prd.title, href: prdHref!, status: delivery?.prdStatus, version: delivery?.prdConfirmedVersion ?? prd.version } : null,
    cases: cases ? { id: cases.id, title: cases.title, href: casesHref!, status: delivery?.casesStatus, passed: testPassed, rounds: lastRound?.round ?? 0 } : null,
    others: others.map((o) => ({ id: o.id, title: o.title, href: `/docs/${o.projectId}/pages/${o.id}` })),
    children: { total: kids.length, online: kidCount(["online"]) },
    openBugs,
    projectId: r.projectId,
  };
}

/** 转化为需求文档：在项目文档空间建一篇（标题 = 需求标题，正文带提出人、来源需求和描述），设为主文档并双向关联 */
export async function convertToDoc(session: SessionUser, id: string, body: Record<string, unknown>) {
  if (!(await requirementVisible(session, id))) return result({ error: "需求不存在" }, { status: 404 });
  const r = await prisma.requirement.findUnique({ where: { id }, include: { proposer: { select: { name: true } }, creator: { select: { name: true } } } });
  if (!r || r.deletedAt) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  if (r.docPageId && (await prisma.docPage.findFirst({ where: { id: r.docPageId, deletedAt: null }, select: { id: true } }))) return result({ error: "已经有主需求文档了" }, { status: 409 });
  const spaceId = r.projectId || String(body.projectId || "");
  if (!spaceId) return result({ error: "公共需求池里的需求，请先选择放到哪个项目的文档空间" }, { status: 400 });
  const space = await prisma.project.findFirst({ where: { id: spaceId, deletedAt: null }, select: { id: true } });
  if (!space || !(await canViewSpace(session, space.id))) return result({ error: "项目不存在" }, { status: 404 });
  if (!(await canEditDocs(session, space.id))) return result({ error: "没有在这个项目写文档的权限" }, { status: 403 });
  const proposer = r.proposer?.name || r.creator.name;
  const html = sanitizeDocHtml(
    `<p>提出人：${escapeHtml(proposer)} · 来源需求：<a class="doc-ref" data-ref-kind="req" data-ref-id="${r.id}">需求</a></p>` +
      (r.descriptionHtml || (r.summary ? `<p>${escapeHtml(r.summary)}</p>` : "")) +
      "<h2>背景与目标</h2><p></p><h2>范围</h2><p></p><h2>验收标准</h2><p></p>",
  );
  const max = await prisma.docPage.aggregate({ where: { projectId: space.id, parentId: null }, _max: { sortOrder: true } });
  const now = new Date();
  const page = await prisma.docPage.create({
    data: { projectId: space.id, title: r.title.slice(0, 200), kind: "doc", body: html, version: 1, publishedAt: now, statusTag: "draft", sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: session.id, updatedById: session.id, versions: { create: { version: 1, title: r.title.slice(0, 200), body: html, authorId: session.id } } },
  });
  await prisma.$transaction([
    prisma.docPageLink.create({ data: { pageId: page.id, requirementId: r.id, source: "manual" } }),
    prisma.requirement.update({ where: { id: r.id }, data: { docPageId: page.id } }),
    prisma.activityLog.create({ data: { entityType: "requirement", entityId: r.id, action: "updated", actorId: session.id, message: `转化为需求文档「${r.title}」` } }),
    prisma.activityLog.create({ data: { entityType: "doc", entityId: page.id, action: "created", actorId: session.id, message: `由需求转化：${r.title}` } }),
  ]);
  return result({ id: page.id, href: `/docs/${space.id}/pages/${page.id}` });
}

/** 关联 / 更换 / 取消主需求文档：{ pageId | null } */
export async function setPrimaryDoc(session: SessionUser, id: string, body: Record<string, unknown>) {
  if (!(await requirementVisible(session, id))) return result({ error: "需求不存在" }, { status: 404 });
  const r = await prisma.requirement.findUnique({ where: { id }, select: { id: true, projectId: true, title: true } });
  if (!r) return result({ error: "需求不存在" }, { status: 404 });
  if (!(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  const pageId = body.pageId ? String(body.pageId) : null;
  if (pageId) {
    const p = await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null, kind: "doc" }, select: { id: true, projectId: true, title: true } });
    if (!p || !(await canViewSpace(session, p.projectId))) return result({ error: "文档不存在" }, { status: 404 });
    await prisma.requirement.update({ where: { id: r.id }, data: { docPageId: p.id } });
    if (!(await prisma.docPageLink.findFirst({ where: { pageId: p.id, requirementId: r.id } }))) await prisma.docPageLink.create({ data: { pageId: p.id, requirementId: r.id, source: "manual" } });
    await prisma.activityLog.create({ data: { entityType: "requirement", entityId: r.id, action: "updated", actorId: session.id, message: `主需求文档设为「${p.title}」` } });
  } else {
    await prisma.requirement.update({ where: { id: r.id }, data: { docPageId: null } });
    await prisma.activityLog.create({ data: { entityType: "requirement", entityId: r.id, action: "updated", actorId: session.id, message: "取消主需求文档" } });
  }
  return result({ ok: true });
}

/** 提出人校验：本企业（当前用户可见范围内）启用的成员 */
export async function validProposer(session: SessionUser, userId: string | null) {
  if (!userId) return true;
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true, AND: [userWhere(await getAccess(session))] }, select: { id: true } });
  return !!u;
}

/** 文档阅读页顶部：这篇文档（或它所在需求交付的 PRD / 用例页）属于哪些需求 */
export async function docRequirements(session: SessionUser, pageId: string) {
  const d = await prisma.delivery.findFirst({ where: { OR: [{ prdPageId: pageId }, { casesPageId: pageId }] }, select: { sourcePageId: true } });
  const ids = [pageId, ...(d ? [d.sourcePageId] : [])];
  const reqs = await prisma.requirement.findMany({ where: { docPageId: { in: ids }, deletedAt: null }, select: { id: true, title: true, status: true, projectId: true, creatorId: true, assignees: { select: { userId: true } } }, take: 5 });
  const out: { id: string; title: string; status: string; href: string }[] = [];
  for (const r of reqs) if (await requirementVisible(session, r.id)) out.push({ id: r.id, title: r.title, status: reqStatusLabel(r.status), href: `/requirements/${r.id}` });
  return out;
}

// ---------- 状态自动流转（T26 决定 2：只在 4 个节点） ----------

const ORDER = ["req_in_progress", "req_done", "dev_todo", "dev_in_progress", "dev_done", "test_todo", "test_in_progress", "test_done", "online"];

/**
 * 把需求往前推到 to（只往前，不往回；已取消、已上线的不动），每条留一条「状态」动态（会触发通知）。
 * reason 写进动态，说明为什么自动改。
 */
export async function advanceRequirements(actorId: string | null, ids: string[], wanted: string, reason: string) {
  if (!ids.length) return 0;
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, status: true, projectId: true, creatorId: true, docPageId: true } });
  const { autoTarget } = await import("../flow/service");
  let n = 0;
  for (const r of rows) {
    if (r.status === "cancelled" || ORDER.indexOf(r.status) >= ORDER.indexOf(wanted)) continue;
    // T41：目标状态在本项目停用就顺延；要求评审且没通过的不自动离开需求阶段
    const to = await autoTarget(r, wanted);
    if (!to || ORDER.indexOf(r.status) >= ORDER.indexOf(to)) continue;
    const ok = await prisma.requirement.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, ...(to === "online" ? { actualEndAt: new Date() } : {}) } });
    if (!ok.count) continue;
    n++;
    await prisma.activityLog.create({
      data: { entityType: "requirement", entityId: r.id, action: "status_changed", actorId, fromValue: JSON.stringify({ status: r.status }), toValue: JSON.stringify({ status: to }), message: `${reason}：状态 ${reqStatusLabel(r.status)} → ${reqStatusLabel(to)}` },
    });
  }
  return n;
}

/** 需求交付对应的业务需求（以原始文档为主文档的）和它的实现需求 */
export async function deliveryRequirements(sourcePageId: string, featureReqs: unknown) {
  const owners = await prisma.requirement.findMany({ where: { docPageId: sourcePageId, deletedAt: null }, select: { id: true } });
  const kids = Object.values((featureReqs as Record<string, string> | null) ?? {});
  return { owners: owners.map((o) => o.id), kids };
}

/** 实现需求上线后：如果业务需求的子需求都上线（或取消）了，业务需求也改成已上线 */
export async function syncParentOnline(actorId: string | null, childIds: string[]) {
  if (!childIds.length) return;
  const parents = await prisma.requirement.findMany({ where: { id: { in: childIds }, parentId: { not: null } }, select: { parentId: true } });
  for (const pid of new Set(parents.map((p) => p.parentId!))) {
    const left = await prisma.requirement.count({ where: { parentId: pid, deletedAt: null, status: { notIn: ["online", "cancelled"] } } });
    if (!left) await advanceRequirements(actorId, [pid], "online", "实现需求全部上线");
  }
}

// ---------- 从文档提取需求（T26 决定 5：小围先列候选，人勾选后再建） ----------

const EXTRACT_PROMPT =
  '你是资深产品经理。从用户给的文档里找出要做的需求（功能、改动、问题），每条一个，不要编造文档里没有的。只输出一个 JSON 对象，不要其他文字：{"requirements":[{"title":"一句话标题，20 字以内","description":"背景、要做什么、验收标准，Markdown","priority":"p0|p1|p2|p3"}]}。p0 紧急、p1 高、p2 中、p3 低，文档没说就用 p2。最多 20 条。';

export async function extractCandidates(session: SessionUser, pageId: string, body: Record<string, unknown>) {
  const { chatOnce } = await import("../ai/providers");
  const { credentialForUse } = await import("../ai/credentials");
  const { recordUsage } = await import("../ai/quota");
  const { docPlainText } = await import("../shared/doc-html");
  const page = await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null }, select: { id: true, title: true, body: true, projectId: true, kind: true } });
  if (!page || !(await canViewSpace(session, page.projectId))) return result({ error: "文档不存在" }, { status: 404 });
  if (page.kind !== "doc") return result({ error: "只有文字页面可以提取需求" }, { status: 400 });
  const text = docPlainText(page.body).trim();
  if (text.replace(/\s/g, "").length < 10) return result({ error: "文档内容太少" }, { status: 400 });
  const use = await credentialForUse(session, String(body.credentialId || ""), String(body.model || ""));
  if ("error" in use) return result({ error: use.error || "模型不可用" }, { status: 402 });
  let out;
  try {
    out = await chatOnce(use.cred, String(body.model), EXTRACT_PROMPT, [{ role: "user", content: `文档「${page.title}」：\n\n${text.slice(0, 30_000)}` }], 4000);
  } catch (e) {
    return result({ error: `模型调用失败：${(e as Error).message}` }, { status: 502 });
  }
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model: String(body.model), feature: "extract", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  const t = out.text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  let list: unknown[] = [];
  try {
    const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    list = Array.isArray(j.requirements) ? j.requirements : [];
  } catch {
    return result({ error: "模型返回的格式不对，请重试或换个模型" }, { status: 502 });
  }
  const items = list
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ title: String(x.title || "").trim().slice(0, 200), description: String(x.description || "").trim().slice(0, 4000), priority: ["p0", "p1", "p2", "p3"].includes(String(x.priority)) ? String(x.priority) : "p2" }))
    .filter((x) => x.title)
    .slice(0, 20);
  return result({ items });
}

/**
 * 11-22 需求池只在项目里：产品资料空间里建需求时放到哪个项目。
 * 传了 projectId 就用它；没传且该产品只有一个进行中项目就用那个；否则返回 null，由调用方提示选项目。
 */
export async function productProjectFor(productId: string | null | undefined, projectId?: string | null): Promise<{ id: string } | null> {
  // 用户选的项目直接用：新建需求接口会再校验能不能看到这个项目
  if (projectId) return { id: projectId };
  if (!productId) return null;
  const rows = await prisma.project.findMany({ where: { productId, status: "active" }, select: { id: true }, take: 50 });
  return rows.length === 1 ? rows[0] : null;
}

/** 把勾选的候选建成需求：放到文档所在项目（产品资料空间的放到所选项目并挂产品），关联这篇文档；还没有主文档的以它为主文档 */
export async function createFromDoc(session: SessionUser, pageId: string, body: Record<string, unknown>) {
  const { POST: createRequirement } = await import("./root");
  const { mdToHtml } = await import("../delivery/blocks");
  const page = await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null }, select: { id: true, title: true, projectId: true, project: { select: { status: true, productId: true } } } });
  if (!page || !(await canViewSpace(session, page.projectId))) return result({ error: "文档不存在" }, { status: 404 });
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20) as Record<string, unknown>[];
  if (!items.length) return result({ error: "请至少勾选一条" }, { status: 400 });
  const isProduct = page.project.status === "space";
  let targetProject = page.projectId;
  if (isProduct) {
    const p = await productProjectFor(page.project.productId, body.projectId ? String(body.projectId) : null);
    if (!p) return result({ error: "请选择需求放到哪个项目", code: "project_required" }, { status: 400 });
    targetProject = p.id;
  }
  const created: string[] = [];
  for (const it of items) {
    const title = String(it.title || "").trim().slice(0, 200);
    if (!title) continue;
    const html = `${mdToHtml(String(it.description || ""))}<p>来自文档：<a href="/docs/${page.projectId}/pages/${page.id}">${escapeHtml(page.title)}</a></p>`;
    const r = await createRequirement(session, { title, projectId: targetProject, ...(isProduct && page.project.productId ? { productRefId: page.project.productId } : {}), priority: String(it.priority || "p2"), descriptionHtml: html });
    if (r.init?.status && r.init.status >= 400) return result({ error: String((r.body as { error?: string }).error || "创建失败"), created: created.length }, { status: r.init.status });
    const id = String((r.body as { id?: string }).id || "");
    if (!id) continue;
    created.push(id);
    await prisma.docPageLink.create({ data: { pageId: page.id, requirementId: id, source: "manual" } }).catch(() => {});
    await prisma.requirement.updateMany({ where: { id, docPageId: null }, data: { docPageId: page.id } });
  }
  return result({ created: created.length, ids: created });
}

/** 工作台「我提的需求」：提出人是我（没填提出人时按创建人），还没上线 / 取消的，按更新时间 */
export async function proposedByMe(session: SessionUser, take = 6) {
  const { requirementWhere } = await import("../access");
  const where = { deletedAt: null, archivedAt: null, status: { notIn: ["online", "cancelled"] }, OR: [{ proposerId: session.id }, { proposerId: null, creatorId: session.id }], AND: [requirementWhere(await getAccess(session))] };
  const [total, rows] = await Promise.all([
    prisma.requirement.count({ where }),
    prisma.requirement.findMany({ where, select: { id: true, title: true, status: true, docPageId: true, updatedAt: true, project: { select: { name: true } }, _count: { select: { children: true } } }, orderBy: { updatedAt: "desc" }, take }),
  ]);
  return { total, rows: rows.map((r) => ({ id: r.id, title: r.title, status: reqStatusLabel(r.status), project: r.project?.name || "公共池", hasDoc: Boolean(r.docPageId), children: r._count.children })) };
}
