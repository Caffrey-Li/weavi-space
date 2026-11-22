import { randomUUID } from "node:crypto";
import { advanceRequirements, deliveryRequirements } from "../requirements/flow";
import { Prisma, type Delivery, type DocPage } from "@prisma/client";
import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { chatStream, isMaxTokensError, type ChatMessage } from "../ai/providers";
import { IDLE_STOP_MS, abortGeneration, begin, emptyReason, end, generate, liveAppend, liveEnd, liveGet, liveStart, Tracker, type GenWhat, type LiveWhat } from "./progress";
import { credentialForUse } from "../ai/credentials";
import { recordUsage } from "../ai/quota";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { docPlainText, escapeHtml, extractRefs } from "../shared/doc-html";
import { logDoc } from "../shared/docs-api";
import { bugWhere, getAccess, requirementWhere } from "../access";
import { skillPrompt } from "../skills/service";
import { wikiStyleFor } from "../skills/wiki-style";
import { ExtractError, attachmentsText } from "./extract";
import { featureItems, applyBlockOp, blockIndexOf, blockPreview, blocksForAi, featureCodes, mdToHtml, openQuestions, splitBlocks, stripFence } from "./blocks";
import { TestError, finalizeRun, manualBulk, manualResult, saveScripts, setAutoRun, startRun, stopRun, testSetup, testView, voidRun, withReport } from "./testing";
import { casesForAi, casesJson, casesSummary, cleanCase, coverage, dedupeCodes, parseCasesBody, sanitizeCases, stepText, type TestCase } from "../shared/testcases";

/**
 * 需求交付（T24 第一期）：原始文档 → PRD（AI 生成，对话修改，确认）→ 测试用例（AI 生成，对话修改，确认）。
 * PRD、用例都是原始文档的子页面；每次应用修改建议都发布成新版本，撤销 = 把上一版重新发布。
 * 生成在后台进行（同一进程内的异步任务），前端轮询状态；超过 10 分钟仍在生成视为中断，可以重试。
 */

type Stage = "prd" | "cases";
type Suggestion = {
  id: string;
  title: string;
  op: string;
  status: "pending" | "applied" | "ignored" | "undone" | "failed";
  before: string;
  after: string;
  targetHtml?: string;
  html?: string;
  code?: string;
  cases?: TestCase[];
  appliedVersion?: number;
  prevVersion?: number;
  error?: string;
};

class DeliveryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const fail = (e: unknown) => {
  if (e instanceof DeliveryError || e instanceof TestError) return result({ error: e.message }, { status: e.status });
  console.error("[需求交付]", e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
};

const JOB_TIMEOUT = 16 * 60 * 1000;
const busy = (status: string, startedAt: Date | null) => status === "generating" && !!startedAt && Date.now() - startedAt.getTime() < JOB_TIMEOUT;

const PRD_TASK = "按「新建 PRD」模式，根据原始材料直接写出完整 PRD；没法当面确认的问题写进文末「待确认问题」。输出格式以文末系统追加的要求为准。";
const CASES_TASK = "按「生成测试用例」的覆盖规则，根据已确认的 PRD 设计测试用例；输出格式以文末系统追加的要求为准（JSON，不要表格和 YAML）。";

const PRD_FORMAT =
  "\n\n输出要求（系统追加，必须遵守）：只输出 PRD 正文，用 Markdown；不要写文档标题（系统会加），不要前言和结束语。功能清单里每个功能点编号写成 F-01、F-02…，后面的规则、验收标准引用这些编号。最后一节的标题必须是「待确认问题」，每个问题一行列表；没有就写「无」。";

const CASE_FORMAT =
  '每条用例：{"code":"TC-01","title":"用例标题","feature":"F-01","priority":"P0|P1|P2|P3","mode":"auto|manual","precondition":"前置条件","steps":[{"action":"goto|click|fill|select|press|wait|expectText|expectUrl|expectVisible|note","target":"","value":""}],"expected":"预期结果"}。' +
  "步骤：goto 的 target 是以 / 开头的页面路径；click / fill / select / expectVisible 的 target 用定位写法 label=输入框标签、role=button[name=登录]、text=按钮文字、placeholder=输入框提示文字、testid=…、css=选择器（优先 label / role / text）；fill / select 的 value 是要输入或选择的值；wait 的 value 是秒数；expectText 的 value 是页面上应出现的文字；expectUrl 的 value 是地址里应包含的片段。" +
  "登录账号和密码写成 {{username}} 和 {{password}}，不要写真实账号密码。需要扫码、短信验证码、App、人工判断的用例 mode 填 manual，步骤用 note 写清人工操作。";

const CASES_FORMAT =
  `\n\n输出要求（系统追加，必须遵守）：只输出一个 JSON 对象 {"cases":[…]}，不要任何其他文字。${CASE_FORMAT}` +
  "每个功能点至少一条用例，覆盖正常流程、边界、异常和权限；feature 填对应的 PRD 功能点编号；编号从 TC-01 开始连续。";

const PRD_CHAT = `你是小围，正在帮用户修改一份 PRD（产品需求文档）。下面是 PRD 当前内容，每个顶层块前有编号 [B1]、[B2]…。
- 用户提问就直接回答，简洁，用中文。
- 需要改文档时（用户提出修改，或回答了待确认问题），先用一两句话说明要改什么，然后在回复最后输出一个 \`\`\`suggestions 代码块，内容是 JSON 数组，每项：{"title":"简短说明，如：3.2 二维码有效期","op":"replace|insert_after|delete","block":"B12","markdown":"新内容（Markdown）"}。replace 用新内容整块替换；insert_after 在该块后插入；delete 删除该块（不需要 markdown）。
- 列表是一个块：只改列表里的一条，也要用 replace 给出整份新列表。
- 用户回答了「待确认问题」里的问题后，同时建议把这个问题从待确认问题列表里去掉；全部回答完就把列表改成「无」。
- 只引用存在的块号，一次最多 8 条；不要在 suggestions 之外重复贴出整段新内容。
- 不要编造用户没说过的业务规则，拿不准就问。`;

const CASES_CHAT = `你是小围，正在帮测试修改一份测试用例。下面是当前用例（JSON）和它依据的 PRD。
- 提问就直接回答，简洁，用中文。
- 需要改用例时，先用一两句话说明，然后在回复最后输出一个 \`\`\`suggestions 代码块，内容是 JSON 数组，每项是下面三种之一：{"title":"新增 2 条权限用例","op":"add","cases":[用例…]}、{"title":"TC-03 改成等待 2 分钟","op":"update","code":"TC-03","case":{完整用例}}、{"title":"删除 TC-07","op":"delete","code":"TC-07"}。一次最多 8 条。
- ${CASE_FORMAT}`;

// ---------- 读 ----------

async function pageOrThrow(id: string | null | undefined) {
  if (!id) return null;
  const p = await prisma.docPage.findUnique({ where: { id } });
  return p && !p.deletedAt ? p : null;
}

async function checkSpace(session: SessionUser, projectId: string, edit: boolean) {
  if (!(await canViewSpace(session, projectId))) throw new DeliveryError("页面不存在或已删除", 404);
  const canEdit = await canEditDocs(session, projectId);
  if (edit && !canEdit) throw new DeliveryError("没有编辑这个空间文档的权限", 403);
  return canEdit;
}

/** T54：面板查看用，也认测试报告页（deliveryRun.reportPageId）；生成 PRD 等写操作仍用 deliveryFor */
async function deliveryForView(pageId: string) {
  const d = await deliveryFor(pageId);
  if (d) return { d, report: false };
  const run = await prisma.deliveryRun.findFirst({ where: { reportPageId: pageId }, select: { deliveryId: true } });
  const r = run ? await prisma.delivery.findUnique({ where: { id: run.deliveryId } }) : null;
  if (r) return { d: r, report: true };
  // T58 AI 评审页（PRD 的子页面）：面板停在「原型设计」
  const pg = await prisma.docPage.findUnique({ where: { id: pageId }, select: { parentId: true, title: true } });
  const rv = pg?.parentId && pg.title.startsWith("AI 评审") ? await prisma.delivery.findFirst({ where: { prdPageId: pg.parentId } }) : null;
  return rv ? { d: rv, report: false, review: true } : { d: null, report: false };
}

async function deliveryFor(pageId: string) {
  return prisma.delivery.findFirst({ where: { OR: [{ sourcePageId: pageId }, { prdPageId: pageId }, { casesPageId: pageId }] } });
}

/** 生成进度：ageMs 用服务器时间算，避免浏览器时钟不准 */
function progressView(d: Delivery) {
  const p = d.jobProgress as Record<string, unknown> | null;
  if (!p || !(busy(d.prdStatus, d.jobStartedAt) || busy(d.casesStatus, d.jobStartedAt) || busy(d.protoStatus, d.jobStartedAt) || busy(d.reviewStatus, d.jobStartedAt))) return null;
  const now = Date.now();
  return { ...p, ageMs: Math.max(0, now - new Date(String(p.lastAt)).getTime()), elapsedMs: Math.max(0, now - new Date(String(p.startedAt)).getTime()) };
}

function view(d: Delivery) {
  return {
    id: d.id,
    prdStatus: busy(d.prdStatus, d.jobStartedAt) || d.prdStatus !== "generating" ? d.prdStatus : d.prdPageId ? "draft" : "failed",
    casesStatus: busy(d.casesStatus, d.jobStartedAt) || d.casesStatus !== "generating" ? d.casesStatus : d.casesPageId ? "draft" : "failed",
    protoStatus: busy(d.protoStatus, d.jobStartedAt) || d.protoStatus !== "generating" ? d.protoStatus : d.protoAttachmentId ? "draft" : "none",
    protoVersion: d.protoVersion,
    protoSkillId: d.protoSkillId,
    reviewStatus: busy(d.reviewStatus, d.jobStartedAt) || d.reviewStatus !== "generating" ? d.reviewStatus : d.reviewPageId ? "done" : "none",
    reviewPageId: d.reviewPageId,
    prdConfirmedVersion: d.prdConfirmedVersion,
    prdConfirmedAt: d.prdConfirmedAt,
    casesConfirmedVersion: d.casesConfirmedVersion,
    casesBasisVersion: d.casesBasisVersion,
    casesStale: d.casesPageId != null && d.prdConfirmedVersion != null && d.casesBasisVersion != null && d.casesBasisVersion !== d.prdConfirmedVersion,
    prdSkillId: d.prdSkillId,
    casesSkillId: d.casesSkillId,
    credentialId: d.credentialId,
    model: d.model,
    error: d.error,
    progress: progressView(d),
    splitCount: Object.keys((d.featureReqs as Record<string, string> | null) ?? {}).length,
  };
}

const pageInfo = (p: DocPage | null) => (p ? { id: p.id, title: p.title, version: p.version, hasDraft: p.draftBody != null && p.version > 0 } : null);

/** 交付面板数据：{ pageId } 可以是原始文档、PRD 或用例页 */
export async function getDelivery(session: SessionUser, pageId: string) {
  try {
    const page = await pageOrThrow(pageId);
    if (!page) throw new DeliveryError("页面不存在或已删除", 404);
    const canEdit = await checkSpace(session, page.projectId, false);
    const view_ = await deliveryForView(page.id);
    const { d, report: isReport } = view_;
    const isReview = "review" in view_ && !!view_.review;
    if (!d) {
      return result({
        delivery: null,
        role: "source",
        canEdit,
        canStart: canEdit && page.kind === "doc",
        source: { id: page.id, title: page.title, chars: docPlainText(page.body).replace(/\s/g, "").length },
      });
    }
    const [source, prd, cases, messages] = await Promise.all([
      pageOrThrow(d.sourcePageId),
      pageOrThrow(d.prdPageId),
      pageOrThrow(d.casesPageId),
      prisma.deliveryMessage.findMany({ where: { deliveryId: d.id }, orderBy: { createdAt: "asc" }, take: 400 }),
    ]);
    const list = parseCasesBody(cases?.body || "");
    const features = prd ? featureCodes(prd.body) : [];
    return result({
      delivery: view(d),
      role: page.id === d.prdPageId ? "prd" : page.id === d.casesPageId ? "cases" : isReport ? "report" : isReview ? "review" : "source",
      canEdit,
      canStart: canEdit,
      source: source ? { id: source.id, title: source.title, chars: docPlainText(source.body).replace(/\s/g, "").length } : null,
      prd: prd ? { ...pageInfo(prd), openQuestions: openQuestions(prd.body), features } : null,
      cases: cases ? { ...pageInfo(cases), summary: casesSummary(list), coverage: coverage(features, list) } : null,
      tests: d.casesPageId ? await testView(d) : null,
      // T58 原型与设计、AI 评审
      design: {
        prototype: d.protoAttachmentId ? { version: d.protoVersion, href: `/api/deliveries/${d.id}/prototype` } : null,
        artifacts: (await designArtifacts(d)).map((a) => ({ id: a.id, requirementId: a.requirementId, kind: a.kind, source: a.source, title: a.title, href: a.href, note: a.note })),
        owners: (await deliveryRequirements(d.sourcePageId, d.featureReqs)).owners,
        review: d.reviewPageId ? await (async () => {
          const p = await pageOrThrow(d.reviewPageId);
          return p ? { id: p.id, title: p.title, verdict: (docPlainText(p.body).match(/结论[:：]\s*(有条件通过|不通过|通过)/) || [])[1] || null } : null;
        })() : null,
      },
      messages: messages.map((m) => ({ id: m.id, stage: m.stage, role: m.role, content: m.content, suggestions: (m.suggestions as Suggestion[] | null)?.map((s) => publicSuggestion(s, m.stage === "prd" ? prd?.body : undefined)) ?? [], createdAt: m.createdAt })),
    });
  } catch (e) {
    return fail(e);
  }
}

/** T52：待确认的 PRD 修改带上新内容和在当前正文里的位置（顶层块序号），文档里按修订显示；找不到位置为 -1 */
const publicSuggestion = (s: Suggestion, prdBody?: string) => ({
  id: s.id,
  title: s.title,
  op: s.op,
  status: s.status,
  before: s.before,
  after: s.after,
  error: s.error,
  ...(prdBody != null && s.status === "pending" && s.targetHtml ? { index: blockIndexOf(prdBody, s.targetHtml), html: s.html ?? "" } : {}),
});

// ---------- T54 自然语言转用例 ----------

const CASE_TEXT = `你是小围，帮测试把一段自然语言描述写成一条结构化测试用例。只输出一个 JSON 对象（一条用例），不要任何其他文字。`;
const FIELD_TEXT: Record<string, string> = {
  precondition: "把用户写的前置条件改写成规范的测试文档语言：一句话写清账号、数据和环境状态，账号密码写成 {{username}} / {{password}}。",
  expected: "把用户写的预期结果改写成规范的测试文档语言：可观察、可判断，写清页面上应出现什么、数值是多少。",
};

/**
 * 编辑用例时「小围转成用例」：{ text, field?: "all" | "precondition" | "expected", current, credentialId, model }。
 * field = all：按描述写整条用例（标题、功能点、前置条件、步骤、预期）；单个字段：只把该字段改写成文档语言。不写库，前端填进表单让人确认。
 */
export async function caseFromText(session: SessionUser, pageId: string, body: Record<string, unknown>) {
  try {
    const page = await pageOrThrow(pageId);
    if (!page || page.kind !== "testcases") throw new DeliveryError("用例页不存在", 404);
    await checkSpace(session, page.projectId, true);
    const text = String(body.text || "").trim().slice(0, 4000);
    if (text.replace(/\s/g, "").length < 4) throw new DeliveryError("先写一句描述");
    const field = body.field === "precondition" || body.field === "expected" ? body.field : "all";
    const { use, model } = await pickModel(session, body, null);
    const current = cleanCase(body.current, 0);
    const d = await deliveryFor(page.id);
    const prd = d ? await pageOrThrow(d.prdPageId) : null;
    const ctx = prd ? `\n\n依据的 PRD（功能点编号 F-01…）：\n${docPlainText(prd.body).slice(0, 8000)}` : "";
    if (field !== "all") {
      const out = await ask(session, use, model, `你是小围，帮测试改写用例里的一个字段。${FIELD_TEXT[field]}只输出改写后的这一句（或几句），不要解释，不要引号。`, [{ role: "user", content: `用例：${current?.title || "（未命名）"}\n原文：${text}` }], 800);
      return result({ field, value: stripFence(out).replace(/^["“「]|["”」]$/g, "").trim().slice(0, field === "expected" ? 1000 : 500) });
    }
    const out = await ask(session, use, model, `${CASE_TEXT}\n${CASE_FORMAT}${ctx}`, [{ role: "user", content: `${current ? `当前用例（可以参考，按描述改）：${JSON.stringify(current)}\n\n` : ""}描述：${text}` }], 3000);
    const v = parseJsonLoose(out);
    const raw = Array.isArray(v) ? v[0] : v && typeof v === "object" && Array.isArray((v as { cases?: unknown[] }).cases) ? (v as { cases: unknown[] }).cases[0] : v;
    const c = cleanCase(raw, 0);
    if (!c) throw new DeliveryError("小围没写出有效的用例，换个说法或换个模型再试");
    return result({ field, case: { ...c, code: current?.code || c.code } });
  } catch (e) {
    return fail(e);
  }
}

// ---------- T53 实时正文 ----------

/** 从流式 JSON 里取出已经写完整的用例对象（{"cases":[{…},{…},… 还没写完） */
function partialCases(text: string): TestCase[] {
  const t = String(text || "");
  const start = t.indexOf("[");
  if (start < 0) return [];
  const out: TestCase[] = [];
  let depth = 0;
  let from = -1;
  let inStr = false;
  let esc = false;
  for (let i = start + 1; i < t.length && out.length < 300; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) from = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && from >= 0) {
        try {
          const c = cleanCase(JSON.parse(t.slice(from, i + 1)), out.length);
          if (c) out.push(c);
        } catch {
          /* 半截对象：跳过 */
        }
        from = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function casesTable(cases: TestCase[]) {
  if (!cases.length) return "";
  const rows = cases
    .map((c) => `<tr><td>${escHtml(c.code)}</td><td>${escHtml(c.title)}</td><td>${escHtml(c.feature || "—")}</td><td>${c.priority}</td><td>${c.mode === "auto" ? "自动" : "手工"}</td><td>${escHtml(c.expected)}</td></tr>`)
    .join("");
  return `<table><thead><tr><th>编号</th><th>用例标题</th><th>功能点</th><th>优先级</th><th>方式</th><th>预期结果</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** 对话回复的实时文字：去掉还没写完的 suggestions 代码块 */
function chatVisible(t: string) {
  let s = t.replace(/```suggestions[\s\S]*$/i, "");
  // 末尾半截的代码块开头（```、```sugg…）也先不显示
  const i = s.lastIndexOf("```");
  if (i >= 0 && "suggestions".startsWith(s.slice(i + 3).trim().toLowerCase())) s = s.slice(0, i);
  return s.replace(/`{1,2}$/, "").trim();
}

/** 生成中的实时内容（只在本进程内存里）：PRD / 报告按 Wiki 渲染，用例按表格，对话回复给纯文字 */
export async function deliveryLive(session: SessionUser, id: string, what: string) {
  try {
    const d = await prisma.delivery.findUnique({ where: { id }, select: { projectId: true } });
    if (!d) throw new DeliveryError("需求交付不存在", 404);
    await checkSpace(session, d.projectId, false);
    if (!["prd", "cases", "report", "chat", "prototype", "review"].includes(what)) throw new DeliveryError("参数不对");
    const l = liveGet(id, what as LiveWhat);
    if (!l) return result({ active: false });
    const base = { active: true, title: l.title, chars: l.text.length, thinkChars: l.think.length, startedAt: new Date(l.startedAt).toISOString(), ageMs: Date.now() - l.lastAt };
    // T56：推理模型先长时间思考，正文还没开始时把思考里的草稿（多半就是 PRD 的雏形）给文档区看
    const draft = !l.text && l.think && what !== "chat" ? { thinkHtml: mdToHtml(stripFence(l.think.slice(-12_000).replace(/```[a-z]*\s*$/i, ""))) } : {};
    if (what === "chat") return result({ ...base, text: chatVisible(l.text).slice(-20_000) });
    // T58 原型是 HTML：文档区用 /prototype?v=live 在沙箱里实时预览，这里只给进度
    if (what === "prototype") return result({ ...base, ...draft, html: "" });
    if (what === "cases") {
      const cases = partialCases(l.text);
      return result({ ...base, ...draft, count: cases.length, html: casesTable(cases) });
    }
    return result({ ...base, ...draft, html: mdToHtml(stripFence(l.text.replace(/```[a-z]*\s*$/i, ""))) });
  } catch (e) {
    return fail(e);
  }
}

// ---------- 发布一版 ----------

/** 把新正文发布成页面的新一版（和「发布」一致：版本 +1，留历史，重建正文里的需求 / Bug 引用） */
async function publishVersion(session: SessionUser, pageId: string, title: string, body: string, note: string) {
  const page = await prisma.docPage.findUnique({ where: { id: pageId } });
  if (!page || page.deletedAt) throw new DeliveryError("页面不存在或已删除", 404);
  if (page.archivedAt) throw new DeliveryError("页面已归档，先取消归档");
  if (page.draftBody != null && page.version > 0) throw new DeliveryError("这个页面有未发布的草稿：先在编辑页发布或放弃草稿，再应用修改", 409);
  const version = page.version + 1;
  const refs = page.kind === "doc" ? extractRefs(body) : [];
  const access = await getAccess(session);
  const [reqs, bugs] = refs.length
    ? await Promise.all([
        prisma.requirement.findMany({ where: { id: { in: refs.filter((r) => r.kind === "req").map((r) => r.id) }, AND: [requirementWhere(access)] }, select: { id: true } }),
        prisma.bug.findMany({ where: { id: { in: refs.filter((r) => r.kind === "bug").map((r) => r.id) }, AND: [bugWhere(access)] }, select: { id: true } }),
      ])
    : [[], []];
  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.docPage.update({ where: { id: page.id, revision: page.revision }, data: { title, body, draftTitle: null, draftBody: null, draftUpdatedAt: null, version, updatedById: session.id, publishedAt: now } }),
      prisma.docPageVersion.create({ data: { pageId: page.id, version, title, body, authorId: session.id } }),
      prisma.docPageLink.deleteMany({ where: { pageId: page.id, source: "body" } }),
      ...reqs.map((r) => prisma.docPageLink.create({ data: { pageId: page.id, requirementId: r.id, source: "body" } })),
      ...bugs.map((b) => prisma.docPageLink.create({ data: { pageId: page.id, bugId: b.id, source: "body" } })),
    ]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2025" || code === "P2002") throw new DeliveryError("页面刚被别人改过，请刷新后再试", 409);
    throw e;
  }
  await logDoc(session.id, page.id, "published", `${note}：${title}（第 ${version} 版）`, { version });
  return { version, prev: page.version };
}

async function childPage(session: SessionUser, source: DocPage, title: string, kind: "doc" | "testcases") {
  const max = await prisma.docPage.aggregate({ where: { projectId: source.projectId, parentId: source.id }, _max: { sortOrder: true } });
  const p = await prisma.docPage.create({
    data: { projectId: source.projectId, parentId: source.id, title, kind, body: kind === "testcases" ? casesJson([]) : "", statusTag: "draft", sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: session.id, updatedById: session.id },
  });
  await logDoc(session.id, p.id, "created", `需求交付新建页面：${title}`);
  return p;
}

async function notifyDone(userId: string, title: string, href: string, body?: string) {
  await prisma.notification.create({ data: { userId, kind: "system", title, body: body?.slice(0, 500), href, entityType: "doc" } }).catch(() => {});
}

// ---------- 模型 ----------

type Use = Exclude<Awaited<ReturnType<typeof credentialForUse>>, { error: string }>;

async function pickModel(session: SessionUser, body: Record<string, unknown>, d?: Delivery | null) {
  const credentialId = String(body.credentialId || d?.credentialId || "");
  const model = String(body.model || d?.model || "");
  if (!credentialId || !model) throw new DeliveryError("请先选择模型（设置 · 模型管理里添加）");
  const use = await credentialForUse(session, credentialId, model);
  if ("error" in use) throw new DeliveryError(use.error || "模型不可用，请重新选择", 402);
  return { use, model, credentialId };
}

async function ask(session: SessionUser, use: Use, model: string, system: string, messages: ChatMessage[], maxTokens: number, liveId?: string) {
  // 流式收（推理模型的思考单独计数），输出上限给大一些，厂商不接受时退回原来的上限
  // T53：回复边收边放进实时正文，对话栏流式显示
  const onDelta = liveId ? (x: { kind: string; text: string }) => void (x.kind === "text" && liveAppend(liveId, "chat", x.text)) : undefined;
  if (liveId) liveStart(liveId, "chat", "");
  let out;
  try {
    try {
      out = await chatStream(use.cred, model, system, messages, Math.max(maxTokens, 16_000), { idleMs: IDLE_STOP_MS, onDelta });
    } catch (e) {
      if (!isMaxTokensError((e as Error).message)) throw e;
      if (liveId) liveStart(liveId, "chat", "");
      out = await chatStream(use.cred, model, system, messages, maxTokens, { idleMs: IDLE_STOP_MS, onDelta });
    }
  } finally {
    if (liveId) liveEnd(liveId, "chat");
  }
  if (!out.text.trim() && out.thinkChars) throw new DeliveryError(emptyReason(out));
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "delivery", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  return out.text;
}

export function parseJsonLoose(text: string): unknown {
  const t = stripFence(String(text || "").replace(/^```json/i, "```"));
  // 先试最先出现的括号：[{…}] 要按数组解析，不能截成里面的对象
  const pairs: [string, string][] = t.indexOf("[") >= 0 && (t.indexOf("{") < 0 || t.indexOf("[") < t.indexOf("{")) ? [["[", "]"], ["{", "}"]] : [["{", "}"], ["[", "]"]];
  for (const [a, b] of pairs) {
    const i = t.indexOf(a);
    const j = t.lastIndexOf(b);
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(t.slice(i, j + 1));
      } catch {
        /* 换下一种 */
      }
    }
  }
  return null;
}

// ---------- 生成 PRD ----------

/** 开始生成 PRD：{ pageId, skillId, credentialId, model, note? }；已有草稿时是「重新生成」（发布成新版本） */
export async function startPrd(session: SessionUser, body: Record<string, unknown>) {
  try {
    const source = await pageOrThrow(String(body.pageId || ""));
    if (!source) throw new DeliveryError("页面不存在或已删除", 404);
    await checkSpace(session, source.projectId, true);
    let d = await deliveryFor(source.id);
    if (d && d.sourcePageId !== source.id) throw new DeliveryError("这是需求交付生成的页面，请在原始文档上操作");
    if (source.kind !== "doc") throw new DeliveryError("只有文字页面可以生成 PRD");
    const text = docPlainText(source.body).trim();
    let extra = { text: "", names: [] as string[] };
    try {
      extra = attachmentsText(body.files);
    } catch (e) {
      if (e instanceof ExtractError) throw new DeliveryError(e.message);
      throw new DeliveryError("附件读不出来，请检查文件格式");
    }
    if ((text + extra.text).replace(/\s/g, "").length < 20) throw new DeliveryError(source.version === 0 ? "原始文档还没有发布，先发布再生成" : "原始文档内容太少，先写清楚基础需求或纪要");
    const skillId = String(body.skillId || "builtin:prd");
    const sk = await skillPrompt(session, skillId, PRD_TASK);
    if (!sk) throw new DeliveryError("能力不存在", 404);
    const { use, model, credentialId } = await pickModel(session, body, d);
    if (d && busy(d.prdStatus, d.jobStartedAt)) throw new DeliveryError("正在生成，请稍候", 409);
    if (d && d.prdStatus === "confirmed") throw new DeliveryError("PRD 已确认，要重新生成请先「重新打开」");
    if (!d) d = await prisma.delivery.create({ data: { projectId: source.projectId, sourcePageId: source.id, createdById: session.id } });
    const claimed = await prisma.delivery.updateMany({
      where: { id: d.id, prdStatus: d.prdStatus, updatedAt: d.updatedAt },
      data: { prdStatus: "generating", jobStartedAt: new Date(), jobProgress: Prisma.DbNull, error: null, prdSkillId: skillId, credentialId, model },
    });
    if (!claimed.count) throw new DeliveryError("正在生成，请稍候", 409);
    const note = String(body.note || "").trim().slice(0, 2000);
    void runPrd(session, d.id, source, sk.prompt, use, model, extra.text ? `${text}\n\n${extra.text}` : text, note, extra.names.length);
    return result({ id: d.id, prdStatus: "generating" });
  } catch (e) {
    return fail(e);
  }
}

async function runPrd(session: SessionUser, id: string, source: DocPage, prompt: string, use: Use, model: string, text: string, note: string, attachments = 0) {
  const input = `原始材料来自文档「${source.title}」（含附加的文件）：\n\n${text.slice(0, 50_000)}${note ? `\n\n补充说明：${note}` : ""}`;
  const tracker = new Tracker(id, { what: "prd", model, inputChars: Math.min(text.length, 50_000), attachments });
  const ctrl = begin(id, "prd");
  liveStart(id, "prd", `PRD · ${source.title}`.slice(0, 200));
  try {
    await tracker.set({ stage: "prepare" });
    // PRD 直接写进文档空间（Wiki）：内容按 PRD 模板，呈现按 Wiki 输出规范
    const out = await generate(use.cred, model, prompt + PRD_FORMAT + (await wikiStyleFor(session.id)), [{ role: "user", content: input }], tracker, ctrl.signal);
    tracker.stop();
    await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "delivery", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    const html = mdToHtml(stripFence(out.text));
    if (!docPlainText(html).trim()) throw new DeliveryError(emptyReason(out));
    await tracker.set({ stage: "save" });
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id } });
    if (d.prdStatus !== "generating") return; // 已被停止
    const title = `PRD · ${source.title}`.slice(0, 200);
    let prd = await pageOrThrow(d.prdPageId);
    if (!prd) prd = await childPage(session, source, title, "doc");
    await publishVersion(session, prd.id, prd.title || title, html, d.prdPageId ? "重新生成 PRD" : "生成 PRD");
    await prisma.delivery.update({ where: { id }, data: { prdPageId: prd.id, prdStatus: "draft", error: null, jobStartedAt: null, jobProgress: Prisma.DbNull } });
    const qs = openQuestions(html);
    const feats = featureCodes(html);
    const cut = out.finishReason === "length" || out.finishReason === "max_tokens" ? "\n\n注意：模型写到输出上限停下了，PRD 末尾可能不完整，可以让我补全，或者精简材料后重新生成。" : "";
    const summary =
      `PRD 已生成：${feats.length} 个功能点。` +
      (qs.length ? `有 ${qs.length} 个问题需要你确认：\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n直接在下面回答就行，我会给出对应的修改建议。` : "没有待确认的问题，看一遍没问题就可以「确认 PRD」。") +
      cut;
    await prisma.deliveryMessage.create({ data: { deliveryId: id, stage: "prd", role: "assistant", content: summary } });
    await notifyDone(session.id, `PRD 已生成：${source.title}`, `/docs/${source.projectId}/pages/${prd.id}`, summary);
  } catch (e) {
    tracker.stop();
    const stopped = ctrl.signal.aborted && !(ctrl.signal.reason instanceof Error && /自动停止/.test(ctrl.signal.reason.message));
    if (!stopped) console.error("[需求交付] 生成 PRD 失败", e);
    const d = await prisma.delivery.findUnique({ where: { id } });
    if (d && d.prdStatus === "generating")
      await prisma.delivery.update({ where: { id }, data: { prdStatus: d.prdPageId ? "draft" : "failed", error: `生成 PRD ${stopped ? "已停止" : "失败"}：${(e as Error).message}`.slice(0, 500), jobStartedAt: null, jobProgress: Prisma.DbNull } });
  } finally {
    end(id, "prd", ctrl);
  }
}

// ---------- 生成用例 ----------

async function startCases(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  if (d.prdStatus !== "confirmed") throw new DeliveryError("先确认 PRD，再生成测试用例");
  if (busy(d.casesStatus, d.jobStartedAt)) throw new DeliveryError("正在生成，请稍候", 409);
  if (d.casesStatus === "confirmed") throw new DeliveryError("用例已确认，要重新生成请先「重新打开」");
  const prd = await pageOrThrow(d.prdPageId);
  const source = await pageOrThrow(d.sourcePageId);
  if (!prd || !source) throw new DeliveryError("PRD 或原始文档已删除", 404);
  const skillId = String(body.skillId || "builtin:test-cases");
  const sk = await skillPrompt(session, skillId, CASES_TASK);
  if (!sk) throw new DeliveryError("能力不存在", 404);
  const { use, model, credentialId } = await pickModel(session, body, d);
  const claimed = await prisma.delivery.updateMany({ where: { id: d.id, updatedAt: d.updatedAt }, data: { casesStatus: "generating", jobStartedAt: new Date(), jobProgress: Prisma.DbNull, error: null, casesSkillId: skillId, credentialId, model } });
  if (!claimed.count) throw new DeliveryError("正在生成，请稍候", 409);
  const note = String(body.note || "").trim().slice(0, 2000);
  void runCases(session, d.id, source, prd, sk.prompt, use, model, note);
  return result({ id: d.id, casesStatus: "generating" });
}

async function runCases(session: SessionUser, id: string, source: DocPage, prd: DocPage, prompt: string, use: Use, model: string, note: string) {
  const body = docPlainText(prd.body).slice(0, 30_000);
  const input = `PRD「${prd.title}」（第 ${prd.version} 版）：\n\n${body}${note ? `\n\n补充说明：${note}` : ""}`;
  const tracker = new Tracker(id, { what: "cases", model, inputChars: body.length, attachments: 0 });
  const ctrl = begin(id, "cases");
  liveStart(id, "cases", `测试用例 · ${source.title}`.slice(0, 200));
  try {
    await tracker.set({ stage: "prepare" });
    const out = await generate(use.cred, model, prompt + CASES_FORMAT, [{ role: "user", content: input }], tracker, ctrl.signal);
    tracker.stop();
    await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "delivery", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    if (!out.text.trim()) throw new DeliveryError(emptyReason(out));
    const parsed = sanitizeCases(parseJsonLoose(out.text));
    if (!parsed || !parsed.cases.length) throw new DeliveryError(out.finishReason === "length" || out.finishReason === "max_tokens" ? "模型写到输出上限停下了，用例不完整，请精简 PRD 或换个模型重试" : "模型返回的用例格式不对，请重试或换个模型");
    await tracker.set({ stage: "save" });
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id } });
    if (d.casesStatus !== "generating") return;
    const title = `测试用例 · ${source.title}`.slice(0, 200);
    let page = await pageOrThrow(d.casesPageId);
    if (!page) page = await childPage(session, source, title, "testcases");
    await publishVersion(session, page.id, page.title || title, casesJson(parsed.cases), d.casesPageId ? "重新生成测试用例" : "生成测试用例");
    await prisma.delivery.update({ where: { id }, data: { casesPageId: page.id, casesStatus: "draft", casesBasisVersion: d.prdConfirmedVersion, error: null, jobStartedAt: null, jobProgress: Prisma.DbNull } });
    const sum = casesSummary(parsed.cases);
    const cov = coverage(featureCodes(prd.body), parsed.cases);
    const msg =
      `按 PRD 第 ${prd.version} 版生成了 ${sum.total} 条用例：自动 ${sum.auto} 条、手工 ${sum.manual} 条。` +
      (cov.missing.length ? `${cov.missing.join("、")} 还没有用例，要补吗？` : "每个功能点都有用例了。") +
      "\n\n要增删改直接告诉我，看一遍没问题就可以「确认用例」。";
    await prisma.deliveryMessage.create({ data: { deliveryId: id, stage: "cases", role: "assistant", content: msg } });
    await notifyDone(session.id, `测试用例已生成：${source.title}`, `/docs/${source.projectId}/pages/${page.id}`, msg);
  } catch (e) {
    tracker.stop();
    const stopped = ctrl.signal.aborted && !(ctrl.signal.reason instanceof Error && /自动停止/.test(ctrl.signal.reason.message));
    if (!stopped) console.error("[需求交付] 生成用例失败", e);
    const d = await prisma.delivery.findUnique({ where: { id } });
    if (d && d.casesStatus === "generating")
      await prisma.delivery.update({ where: { id }, data: { casesStatus: d.casesPageId ? "draft" : "none", error: `生成测试用例${stopped ? "已停止" : "失败"}：${(e as Error).message}`.slice(0, 500), jobStartedAt: null, jobProgress: Prisma.DbNull } });
  } finally {
    end(id, "cases", ctrl);
  }
}

/** 停止生成：{ what: "prd" | "cases" } */
async function stopGenerate(d: Delivery, body: Record<string, unknown>) {
  const what: GenWhat = body.what === "cases" ? "cases" : body.what === "prototype" ? "prototype" : body.what === "review" ? "review" : "prd";
  abortGeneration(d.id, what);
  if (what === "prototype") {
    await prisma.delivery.updateMany({ where: { id: d.id, protoStatus: "generating" }, data: { protoStatus: d.protoAttachmentId ? "draft" : "none", error: "生成原型已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
    return;
  }
  if (what === "review") {
    await prisma.delivery.updateMany({ where: { id: d.id, reviewStatus: "generating" }, data: { reviewStatus: d.reviewPageId ? "done" : "none", error: "AI 评审已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
    return;
  }
  // 本进程里没找到（比如服务重启过）也把状态改回来
  if (what === "prd") await prisma.delivery.updateMany({ where: { id: d.id, prdStatus: "generating" }, data: { prdStatus: d.prdPageId ? "draft" : "none", error: "生成 PRD 已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
  else await prisma.delivery.updateMany({ where: { id: d.id, casesStatus: "generating" }, data: { casesStatus: d.casesPageId ? "draft" : "none", error: "生成测试用例已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
}

// ---------- T58 原型与 AI 评审 ----------

const PROTO_TASK = "按「出原型图」模式，依据已确认的 PRD 生成一个单文件 HTML 原型：覆盖 PRD 里的页面和主要交互，可点击切换页面；只用内联 CSS 和内联脚本，不引用任何外部资源。只输出 HTML 代码本身（从 <!doctype html> 开始），不要解释。";
const PROTO_MODIFY = "\n\n这次是在已有原型上修改：保留原型里没要求改的页面、结构和样式，只按「修改要求」改，输出修改后的完整 HTML。";
const REVIEW_TASK = "你是资深产品评审。依据需求文档（PRD）、HTML 原型（已提取成文字）和 UI 设计稿清单做需求验证：检查原型是否覆盖 PRD 的每个功能点和状态、PRD 和原型 / UI 是否矛盾、有没有缺失的异常和空状态、验收标准是否可测。";
const REVIEW_FORMAT = "\n\n输出要求（系统追加，必须遵守）：只输出评审报告正文，用 Markdown，不要写文档标题。第一行必须是「结论：通过」「结论：有条件通过」或「结论：不通过」之一，后面一句话说明理由。然后「## 问题清单」，每个问题一行列表，以【PRD】【原型】【UI】之一开头，写清位置、问题和建议改法；没有问题写「无」。最后「## 建议」。";

/** 需求交付关联的业务需求上的 UI 设计 / 原型资料 */
async function designArtifacts(d: Delivery) {
  const { owners } = await deliveryRequirements(d.sourcePageId, d.featureReqs);
  if (!owners.length) return [];
  const rows = await prisma.requirementArtifact.findMany({ where: { requirementId: { in: owners }, kind: { in: ["ui", "prototype"] } }, orderBy: { createdAt: "asc" }, select: { id: true, requirementId: true, kind: true, source: true, title: true, url: true, note: true, attachmentId: true } });
  return rows.map((a) => ({ ...a, href: a.source === "link" ? a.url : `/api/artifact-raw/${a.id}` }));
}

const htmlOnly = (t: string) => {
  const x = stripFence(String(t || "").replace(/^```html/i, "```"));
  const i = x.search(/<!doctype html|<html/i);
  return (i >= 0 ? x.slice(i) : x).trim();
};
const visibleText = (html: string) => String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function prototypeHtml(d: Delivery, base: string) {
  if (base === "current" || !base) {
    if (!d.protoAttachmentId) return null;
    const a = await prisma.attachment.findUnique({ where: { id: d.protoAttachmentId }, select: { data: true } });
    return a ? Buffer.from(a.data).toString("utf8") : null;
  }
  // 需求上已有的原型资料（HTML 文件）
  const art = (await designArtifacts(d)).find((x) => x.id === base && x.kind === "prototype" && x.attachmentId);
  if (!art) return null;
  const a = await prisma.attachment.findUnique({ where: { id: art.attachmentId! }, select: { data: true, mime: true } });
  return a && a.mime === "text/html" ? Buffer.from(a.data).toString("utf8") : null;
}

/** 生成原型：{ mode: "new" | "modify", base?: "current" | 资料 id, note, skillId, credentialId, model } */
async function startPrototype(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  if (d.prdStatus !== "confirmed") throw new DeliveryError("先确认 PRD，再生成原型");
  if (busy(d.protoStatus, d.jobStartedAt) || busy(d.prdStatus, d.jobStartedAt) || busy(d.casesStatus, d.jobStartedAt) || busy(d.reviewStatus, d.jobStartedAt)) throw new DeliveryError("正在生成，请稍候", 409);
  const prd = await pageOrThrow(d.prdPageId);
  if (!prd) throw new DeliveryError("PRD 已删除", 404);
  const modify = body.mode === "modify";
  const baseHtml = modify ? await prototypeHtml(d, String(body.base || "current")) : null;
  if (modify && !baseHtml) throw new DeliveryError("要修改的原型不存在（只能选 HTML 原型）");
  const note = String(body.note || "").trim().slice(0, 4000);
  if (modify && !note) throw new DeliveryError("写一下要怎么改");
  const skillId = String(body.skillId || "builtin:prototype");
  const sk = await skillPrompt(session, skillId, PROTO_TASK);
  if (!sk) throw new DeliveryError("能力不存在", 404);
  const { use, model, credentialId } = await pickModel(session, body, d);
  const claimed = await prisma.delivery.updateMany({ where: { id: d.id, updatedAt: d.updatedAt }, data: { protoStatus: "generating", jobStartedAt: new Date(), jobProgress: Prisma.DbNull, error: null, protoSkillId: skillId, credentialId, model } });
  if (!claimed.count) throw new DeliveryError("正在生成，请稍候", 409);
  const input = `PRD「${prd.title}」（第 ${prd.version} 版）：\n\n${docPlainText(prd.body).slice(0, 30_000)}${baseHtml ? `\n\n===== 已有原型（HTML） =====\n${baseHtml.slice(0, 60_000)}\n\n===== 修改要求 =====\n${note}` : note ? `\n\n补充说明：${note}` : ""}`;
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage: "design", role: "user", content: modify ? `修改原型：${note}` : `生成原型${note ? `：${note}` : ""}`, userId: session.id } });
  void runPrototype(session, d.id, prd, sk.prompt + (modify ? PROTO_MODIFY : ""), use, model, input, modify);
  return result({ id: d.id, protoStatus: "generating" });
}

async function runPrototype(session: SessionUser, id: string, prd: DocPage, prompt: string, use: Use, model: string, input: string, modify: boolean) {
  const tracker = new Tracker(id, { what: "prototype", model, inputChars: input.length, attachments: 0 });
  const ctrl = begin(id, "prototype");
  liveStart(id, "prototype", `原型 · ${prd.title.replace(/^PRD\s*·\s*/, "")}`.slice(0, 200));
  try {
    await tracker.set({ stage: "prepare" });
    const out = await generate(use.cred, model, prompt, [{ role: "user", content: input }], tracker, ctrl.signal);
    tracker.stop();
    await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "delivery", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    const html = htmlOnly(out.text);
    if (!/<(html|body|div|main)\b/i.test(html)) throw new DeliveryError(out.text.trim() ? "模型没有输出 HTML，请重试或换个模型" : emptyReason(out));
    await tracker.set({ stage: "save" });
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id } });
    if (d.protoStatus !== "generating") return;
    const version = d.protoVersion + 1;
    const data = Buffer.from(html, "utf8");
    const name = `原型-v${version}.html`;
    const att = await prisma.attachment.create({ data: { ownerType: "delivery_proto", ownerId: id, name, mime: "text/html", size: data.length, data, uploaderId: session.id }, select: { id: true } });
    await prisma.delivery.update({ where: { id }, data: { protoStatus: "draft", protoAttachmentId: att.id, protoVersion: version, error: null, jobStartedAt: null, jobProgress: Prisma.DbNull } });
    // 挂到业务需求的资料上（每条需求一份「需求交付生成」的原型，新版本替换旧文件）
    const { owners } = await deliveryRequirements(d.sourcePageId, d.featureReqs);
    for (const reqId of owners) {
      const exist = await prisma.requirementArtifact.findFirst({ where: { requirementId: reqId, kind: "prototype", title: { startsWith: "原型 · 需求交付" } } });
      const a2 = await prisma.attachment.create({ data: { ownerType: "artifact", ownerId: exist?.id ?? null, name, mime: "text/html", size: data.length, data, uploaderId: session.id }, select: { id: true } });
      if (exist) {
        if (exist.attachmentId) await prisma.attachment.deleteMany({ where: { id: exist.attachmentId } });
        await prisma.requirementArtifact.update({ where: { id: exist.id }, data: { attachmentId: a2.id, note: `第 ${version} 版` } });
      } else {
        const r = await prisma.requirement.findUnique({ where: { id: reqId }, select: { workspaceId: true } });
        const art = await prisma.requirementArtifact.create({ data: { workspaceId: r?.workspaceId || "ws_default", requirementId: reqId, kind: "prototype", source: "file", title: "原型 · 需求交付生成", attachmentId: a2.id, note: `第 ${version} 版`, shareToChildren: true, createdById: session.id } });
        await prisma.attachment.update({ where: { id: a2.id }, data: { ownerId: art.id } });
      }
    }
    const msg = `原型第 ${version} 版已${modify ? "按要求修改" : "生成"}${owners.length ? "，已挂到需求的「原型」资料上，需求页和需求文档里都能点开预览" : ""}。可以接着补 UI 设计，或让我做一次 AI 评审。`;
    await prisma.deliveryMessage.create({ data: { deliveryId: id, stage: "design", role: "assistant", content: msg } });
    await notifyDone(session.id, `原型已生成：${prd.title}`, `/docs/${prd.projectId}/pages/${prd.id}`, msg);
  } catch (e) {
    tracker.stop();
    const stopped = ctrl.signal.aborted;
    if (!stopped) console.error("[需求交付] 生成原型失败", e);
    await prisma.delivery.updateMany({ where: { id, protoStatus: "generating" }, data: { protoStatus: "none", error: `生成原型${stopped ? "已停止" : "失败"}：${(e as Error).message}`.slice(0, 500), jobStartedAt: null, jobProgress: Prisma.DbNull } });
    const d = await prisma.delivery.findUnique({ where: { id }, select: { protoAttachmentId: true } });
    if (d?.protoAttachmentId) await prisma.delivery.update({ where: { id }, data: { protoStatus: "draft" } });
  } finally {
    end(id, "prototype", ctrl);
  }
}

/** AI 评审：PRD + 原型 + UI 设计稿清单 → 评审报告（Wiki 文档，PRD 的子页面） */
async function startAiReview(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  if (d.prdStatus !== "confirmed" && d.prdStatus !== "draft") throw new DeliveryError("先生成 PRD");
  if (busy(d.protoStatus, d.jobStartedAt) || busy(d.reviewStatus, d.jobStartedAt)) throw new DeliveryError("正在生成，请稍候", 409);
  const prd = await pageOrThrow(d.prdPageId);
  if (!prd) throw new DeliveryError("PRD 已删除", 404);
  const skillId = String(body.skillId || "builtin:prd-review");
  const sk = await skillPrompt(session, skillId, REVIEW_TASK);
  if (!sk) throw new DeliveryError("能力不存在", 404);
  const { use, model, credentialId } = await pickModel(session, body, d);
  const proto = await prototypeHtml(d, "current");
  const ui = (await designArtifacts(d)).filter((x) => x.kind === "ui");
  const claimed = await prisma.delivery.updateMany({ where: { id: d.id, updatedAt: d.updatedAt }, data: { reviewStatus: "generating", jobStartedAt: new Date(), jobProgress: Prisma.DbNull, error: null, credentialId, model } });
  if (!claimed.count) throw new DeliveryError("正在生成，请稍候", 409);
  const input = [
    `PRD「${prd.title}」（第 ${prd.version} 版）：\n${docPlainText(prd.body).slice(0, 30_000)}`,
    proto ? `HTML 原型（第 ${d.protoVersion} 版，已提取页面文字）：\n${visibleText(proto).slice(0, 15_000)}` : "HTML 原型：还没有",
    ui.length ? `UI 设计稿：\n${ui.map((u) => `- ${u.title}${u.url ? `：${u.url}` : ""}${u.note ? `（${u.note}）` : ""}`).join("\n")}` : "UI 设计稿：还没有",
    String(body.note || "").trim() ? `评审重点：${String(body.note).trim().slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n\n");
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage: "design", role: "user", content: "AI 评审：按 PRD、原型和 UI 做需求验证", userId: session.id } });
  void runAiReview(session, d.id, prd, sk.prompt + REVIEW_FORMAT + (await wikiStyleFor(session.id)), use, model, input);
  return result({ id: d.id, reviewStatus: "generating" });
}

async function runAiReview(session: SessionUser, id: string, prd: DocPage, prompt: string, use: Use, model: string, input: string) {
  const tracker = new Tracker(id, { what: "review", model, inputChars: input.length, attachments: 0 });
  const ctrl = begin(id, "review");
  const n = (await prisma.docPage.count({ where: { parentId: prd.id, title: { startsWith: "AI 评审" }, deletedAt: null } })) + 1;
  const title = `AI 评审 · 第 ${n} 次`;
  liveStart(id, "review", title);
  try {
    await tracker.set({ stage: "prepare" });
    const out = await generate(use.cred, model, prompt, [{ role: "user", content: input }], tracker, ctrl.signal, 12_000);
    tracker.stop();
    await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "delivery", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    const md = stripFence(out.text);
    const html = mdToHtml(md);
    if (!docPlainText(html).trim()) throw new DeliveryError(emptyReason(out));
    await tracker.set({ stage: "save" });
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id } });
    if (d.reviewStatus !== "generating") return;
    const page = await childPage(session, prd, title, "doc");
    await publishVersion(session, page.id, title, html, "AI 评审");
    await prisma.delivery.update({ where: { id }, data: { reviewStatus: "done", reviewPageId: page.id, error: null, jobStartedAt: null, jobProgress: Prisma.DbNull } });
    const verdict = (md.match(/结论[:：]\s*(有条件通过|不通过|通过)/) || [])[1] || "已完成";
    const issues = (md.match(/^\s*[-*]\s*【(PRD|原型|UI)】.*$/gm) || []).map((x) => x.replace(/^\s*[-*]\s*/, ""));
    const msg = `AI 评审结论：${verdict}${issues.length ? `，${issues.length} 个问题：\n${issues.slice(0, 6).map((x, i) => `${i + 1}. ${x}`).join("\n")}${issues.length > 6 ? "\n……" : ""}` : "，没有发现问题。"}\n\n完整报告见「${title}」。有问题可以「按意见改原型」或「按意见改 PRD」，改完再评审一次。`;
    await prisma.deliveryMessage.create({ data: { deliveryId: id, stage: "design", role: "assistant", content: msg } });
    await notifyDone(session.id, `AI 评审完成：${prd.title}`, `/docs/${prd.projectId}/pages/${page.id}`, msg);
  } catch (e) {
    tracker.stop();
    const stopped = ctrl.signal.aborted;
    if (!stopped) console.error("[需求交付] AI 评审失败", e);
    await prisma.delivery.updateMany({ where: { id, reviewStatus: "generating" }, data: { reviewStatus: "none", error: `AI 评审${stopped ? "已停止" : "失败"}：${(e as Error).message}`.slice(0, 500), jobStartedAt: null, jobProgress: Prisma.DbNull } });
    const d = await prisma.delivery.findUnique({ where: { id }, select: { reviewPageId: true } });
    if (d?.reviewPageId) await prisma.delivery.update({ where: { id }, data: { reviewStatus: "done" } });
  } finally {
    end(id, "review", ctrl);
  }
}

/** 当前原型文件（HTML，沙箱里打开） */
export async function deliveryPrototype(session: SessionUser, id: string, version?: string | null) {
  const d = await prisma.delivery.findUnique({ where: { id } });
  if (!d) return null;
  await checkSpace(session, d.projectId, false).catch(() => {
    throw new DeliveryError("不存在", 404);
  });
  if (version === "live") {
    const l = liveGet(id, "prototype");
    return l ? { name: "原型（生成中）.html", data: Buffer.from(htmlOnly(l.text) || "<p style=\"font:14px sans-serif;color:#888\">原型还没开始输出…</p>", "utf8") } : null;
  }
  if (!d.protoAttachmentId) return null;
  const a = await prisma.attachment.findUnique({ where: { id: d.protoAttachmentId }, select: { name: true, data: true } });
  return a ? { name: a.name, data: Buffer.from(a.data) } : null;
}

// ---------- 对话 ----------

function parseSuggestionBlock(text: string): { clean: string; raw: Record<string, unknown>[] } {
  const m = text.match(/```suggestions\s*([\s\S]*?)```/i);
  if (!m) return { clean: text.trim(), raw: [] };
  const v = parseJsonLoose(m[1]);
  const list = Array.isArray(v) ? v : [];
  return { clean: text.replace(m[0], "").trim(), raw: list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, 8) };
}

function prdSuggestions(raw: Record<string, unknown>[], blocks: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of raw) {
    const op = String(r.op || "");
    if (!["replace", "insert_after", "delete"].includes(op)) continue;
    const n = Number(String(r.block || "").replace(/^B/i, ""));
    const target = blocks[n - 1];
    if (!target) continue;
    const html = op === "delete" ? "" : mdToHtml(String(r.markdown || ""));
    if (op !== "delete" && !docPlainText(html).trim()) continue;
    out.push({
      id: randomUUID(),
      title: String(r.title || "修改").slice(0, 80),
      op,
      status: "pending",
      before: op === "insert_after" ? `在「${blockPreview(target, 40)}」后插入` : blockPreview(target),
      after: op === "delete" ? "（删除）" : blockPreview(html),
      targetHtml: target,
      html,
    });
  }
  return out;
}

const caseLine = (c: TestCase) => `${c.code}  ${c.title} · ${c.feature || "—"} · ${c.priority} · ${c.mode === "auto" ? "自动" : "手工"}${c.steps.length ? `\n${c.steps.map((s, i) => `  ${i + 1}. ${stepText(s)}`).join("\n")}` : ""}`;

function casesSuggestions(raw: Record<string, unknown>[], current: TestCase[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of raw) {
    const op = String(r.op || "");
    const title = String(r.title || "修改用例").slice(0, 80);
    if (op === "add") {
      const cases = (Array.isArray(r.cases) ? r.cases : []).map((c, i) => cleanCase(c, current.length + i)).filter((c): c is TestCase => !!c).slice(0, 50);
      if (cases.length) out.push({ id: randomUUID(), title, op, status: "pending", before: "（新增）", after: cases.map(caseLine).join("\n"), cases });
    } else if (op === "update" || op === "delete") {
      const code = String(r.code || "").toUpperCase();
      const old = current.find((c) => c.code === code);
      if (!old) continue;
      const next = op === "update" ? cleanCase({ ...(r.case as object), code }) : null;
      if (op === "update" && !next) continue;
      out.push({ id: randomUUID(), title, op, status: "pending", code, before: caseLine(old), after: next ? caseLine(next) : "（删除）", cases: next ? [next] : [] });
    }
  }
  return out;
}

async function chat(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const stage = body.stage === "cases" ? "cases" : "prd";
  const content = String(body.content || "").trim().slice(0, 4000);
  if (!content) throw new DeliveryError("请输入内容");
  const page = await pageOrThrow(stage === "prd" ? d.prdPageId : d.casesPageId);
  if (!page) throw new DeliveryError(stage === "prd" ? "还没有 PRD，先生成" : "还没有测试用例，先生成");
  const { use, model, credentialId } = await pickModel(session, body, d);
  const history = await prisma.deliveryMessage.findMany({ where: { deliveryId: d.id, stage }, orderBy: { createdAt: "desc" }, take: 16 });
  const mine = await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage, role: "user", content, userId: session.id } });
  let system: string;
  let blocks: string[] = [];
  let current: TestCase[] = [];
  if (stage === "prd") {
    blocks = splitBlocks(page.body);
    // 建议里的 Markdown 会直接写回 PRD，同样按 Wiki 输出规范排版
    system = `${PRD_CHAT}${await wikiStyleFor(session.id)}\n\nPRD「${page.title}」当前内容：\n${blocksForAi(blocks)}`;
  } else {
    current = parseCasesBody(page.body);
    const prd = await pageOrThrow(d.prdPageId);
    system = `${CASES_CHAT}\n\n当前用例：\n${casesForAi(current)}\n\n依据的 PRD：\n${prd ? docPlainText(prd.body).slice(0, 15_000) : "（无）"}`;
  }
  const msgs: ChatMessage[] = [...history.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })), { role: "user", content }];
  // 有的厂商要求第一条必须是 user
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  let text: string;
  try {
    text = await ask(session, use, model, system, msgs, 6000, d.id);
  } catch (e) {
    await prisma.deliveryMessage.delete({ where: { id: mine.id } }).catch(() => {});
    throw new DeliveryError(`模型调用失败：${(e as Error).message}`, 502);
  }
  const { clean, raw } = parseSuggestionBlock(text);
  const suggestions = stage === "prd" ? prdSuggestions(raw, blocks) : casesSuggestions(raw, current);
  const reply = await prisma.deliveryMessage.create({
    data: { deliveryId: d.id, stage, role: "assistant", content: clean || (suggestions.length ? "建议这样改：" : "（没有回复内容）"), suggestions: suggestions.length ? (suggestions as unknown as Prisma.InputJsonArray) : undefined },
  });
  await prisma.delivery.update({ where: { id: d.id }, data: { credentialId, model } });
  return result({ id: reply.id });
}

// ---------- 应用 / 忽略 / 撤销 ----------

async function suggestion(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const msg = await prisma.deliveryMessage.findFirst({ where: { id: String(body.messageId || ""), deliveryId: d.id } });
  if (!msg) throw new DeliveryError("消息不存在", 404);
  const list = ((msg.suggestions as Suggestion[] | null) ?? []).map((s) => ({ ...s }));
  const ids = body.suggestionId === "all" ? list.filter((s) => s.status === "pending").map((s) => s.id) : [String(body.suggestionId || "")];
  const action = String(body.op || "");
  if (!["apply", "ignore", "undo"].includes(action)) throw new DeliveryError("未知操作");
  const stage = msg.stage as Stage;
  if (action !== "ignore" && (stage === "prd" ? d.prdStatus : d.casesStatus) === "confirmed") throw new DeliveryError(stage === "prd" ? "PRD 已确认，要改先「重新打开」" : "用例已确认，要改先「重新打开」");
  const pageId = stage === "prd" ? d.prdPageId : d.casesPageId;
  let applied = 0;
  for (const id of ids) {
    const s = list.find((x) => x.id === id);
    if (!s) continue;
    if (action === "ignore") {
      if (s.status === "pending") s.status = "ignored";
      continue;
    }
    const page = await pageOrThrow(pageId);
    if (!page) throw new DeliveryError("页面不存在或已删除", 404);
    if (action === "undo") {
      if (s.status !== "applied" || !s.prevVersion) throw new DeliveryError("这条修改没有应用过");
      if (page.version !== s.appliedVersion) throw new DeliveryError("之后又有新的修改，不能直接撤销；可以在「版本记录」里恢复");
      const prev = await prisma.docPageVersion.findUnique({ where: { pageId_version: { pageId: page.id, version: s.prevVersion } } });
      if (!prev) throw new DeliveryError("找不到修改前的版本");
      await publishVersion(session, page.id, page.title, prev.body, "撤销小围的修改");
      s.status = "undone";
      continue;
    }
    if (s.status !== "pending") continue;
    let next: string | null = null;
    if (stage === "prd") next = applyBlockOp(page.body, { op: s.op as "replace", targetHtml: s.targetHtml || "", html: s.html || "" });
    else {
      const cur = parseCasesBody(page.body);
      if (s.op === "add") next = casesJson(dedupeCodes([...cur, ...(s.cases || [])]));
      else if (cur.some((c) => c.code === s.code)) next = casesJson(s.op === "delete" ? cur.filter((c) => c.code !== s.code) : cur.map((c) => (c.code === s.code && s.cases?.[0] ? s.cases[0] : c)));
    }
    if (next === null) {
      s.status = "failed";
      s.error = "原文已经变了，这条建议没法自动应用；可以让小围按最新内容重新给建议";
      continue;
    }
    const v = await publishVersion(session, page.id, page.title, next, `应用小围的修改「${s.title}」`);
    s.status = "applied";
    s.appliedVersion = v.version;
    s.prevVersion = v.prev;
    applied++;
  }
  await prisma.deliveryMessage.update({ where: { id: msg.id }, data: { suggestions: list as unknown as Prisma.InputJsonArray } });
  return result({ ok: true, applied });
}

// ---------- 确认 / 重新打开 / 手动改用例 ----------

async function confirm(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const stage: Stage = body.stage === "cases" ? "cases" : "prd";
  const page = await pageOrThrow(stage === "prd" ? d.prdPageId : d.casesPageId);
  if (!page) throw new DeliveryError("页面不存在或已删除", 404);
  if (page.draftBody != null && page.version > 0) throw new DeliveryError("页面有未发布的草稿，先发布或放弃草稿再确认", 409);
  const now = new Date();
  if (stage === "prd") {
    if (d.prdStatus !== "draft") throw new DeliveryError("现在不能确认 PRD");
    await prisma.delivery.update({ where: { id: d.id }, data: { prdStatus: "confirmed", prdConfirmedVersion: page.version, prdConfirmedAt: now, prdConfirmedById: session.id } });
  } else {
    if (d.casesStatus !== "draft") throw new DeliveryError("现在不能确认用例");
    await prisma.delivery.update({ where: { id: d.id }, data: { casesStatus: "confirmed", casesConfirmedVersion: page.version, casesConfirmedAt: now, casesConfirmedById: session.id, casesBasisVersion: d.prdConfirmedVersion } });
  }
  await prisma.docPage.update({ where: { id: page.id }, data: { statusTag: "approved" } });
  let split: { created: number; skipped: number; error?: string } | null = null;
  if (stage === "prd" && body.split === true) split = await splitFeatures(session, d, page);
  if (stage === "prd") {
    const fresh = await prisma.delivery.findUnique({ where: { id: d.id }, select: { featureReqs: true } });
    const { owners, kids } = await deliveryRequirements(d.sourcePageId, fresh?.featureReqs);
    await advanceRequirements(session.id, owners, "req_done", "PRD 已确认");
    await advanceRequirements(session.id, kids, "dev_todo", "PRD 已确认");
  }
  await logDoc(session.id, page.id, "status", stage === "prd" ? `确认 PRD（第 ${page.version} 版）` : `确认测试用例（第 ${page.version} 版）`, { to: "approved" });
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage, role: "assistant", content: stage === "prd" ? `PRD 第 ${page.version} 版已确认。下一步可以生成测试用例。` : `测试用例第 ${page.version} 版已确认。下一步：选测试环境，发起测试。` } });
  return result({ ok: true, split });
}

/** 确认 PRD 时把功能清单拆成项目需求池里的需求：每个功能点一条，已拆过的不重复建；需求描述带回 PRD 的链接 */
async function splitFeatures(session: SessionUser, d: Delivery, prd: DocPage) {
  const { POST: createRequirement } = await import("../requirements/root");
  const map = { ...((d.featureReqs as Record<string, string> | null) ?? {}) };
  // 拆出的实现需求挂在业务需求（以原始文档为主需求文档的那条）下面
  const owner = (await prisma.requirement.findFirst({ where: { docPageId: d.sourcePageId, deletedAt: null, parentId: null }, select: { id: true } }))?.id;
  const alive = new Set((await prisma.requirement.findMany({ where: { id: { in: Object.values(map) }, deletedAt: null }, select: { id: true } })).map((r) => r.id));
  let created = 0;
  let skipped = 0;
  let error: string | undefined;
  for (const f of featureItems(prd.body)) {
    if (map[f.code] && alive.has(map[f.code])) {
      skipped++;
      continue;
    }
    const r = await createRequirement(session, { title: `${f.code} ${f.title}`.slice(0, 200), projectId: d.projectId, ...(owner ? { parentId: owner } : {}), descriptionHtml: `<p>来自 PRD：<a href="/docs/${prd.projectId}/pages/${prd.id}">${escapeHtml(prd.title)}</a>（第 ${prd.version} 版）功能点 ${f.code}</p>` });
    if (r.init?.status && r.init.status >= 400) {
      error = String((r.body as { error?: string }).error || "拆需求失败");
      break;
    }
    const id = String((r.body as { id?: string }).id || "");
    if (!id) continue;
    map[f.code] = id;
    created++;
    await prisma.docPageLink.create({ data: { pageId: prd.id, requirementId: id, source: "manual" } }).catch(() => {});
  }
  await prisma.delivery.update({ where: { id: d.id }, data: { featureReqs: map } });
  return { created, skipped, error };
}

async function reopen(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const stage: Stage = body.stage === "cases" ? "cases" : "prd";
  const status = stage === "prd" ? d.prdStatus : d.casesStatus;
  if (status !== "confirmed") throw new DeliveryError("还没有确认，不需要重新打开");
  if (stage === "prd" && busy(d.casesStatus, d.jobStartedAt)) throw new DeliveryError("用例正在生成，等生成完再重新打开 PRD");
  await prisma.delivery.update({ where: { id: d.id }, data: stage === "prd" ? { prdStatus: "draft" } : { casesStatus: "draft" } });
  const pageId = stage === "prd" ? d.prdPageId : d.casesPageId;
  if (pageId) {
    await prisma.docPage.update({ where: { id: pageId }, data: { statusTag: "draft" } });
    await logDoc(session.id, pageId, "status", stage === "prd" ? "重新打开 PRD" : "重新打开测试用例", { to: "draft" });
  }
  return result({ ok: true });
}

/** 在用例表里手动改一条 / 删一条：{ code, case? }，case 为空表示删除 */
async function saveCase(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  if (d.casesStatus === "confirmed") throw new DeliveryError("用例已确认，要改先「重新打开」");
  const page = await pageOrThrow(d.casesPageId);
  if (!page) throw new DeliveryError("还没有测试用例", 404);
  const cur = parseCasesBody(page.body);
  const code = String(body.code || "").toUpperCase();
  let next: TestCase[];
  if (!body.case) {
    if (!cur.some((c) => c.code === code)) throw new DeliveryError("用例不存在", 404);
    next = cur.filter((c) => c.code !== code);
  } else {
    const c = cleanCase({ ...(body.case as object), code: code || undefined }, cur.length);
    if (!c) throw new DeliveryError("请填写用例标题");
    next = code && cur.some((x) => x.code === code) ? cur.map((x) => (x.code === code ? c : x)) : dedupeCodes([...cur, c]);
  }
  await publishVersion(session, page.id, page.title, casesJson(next), code ? `修改用例 ${code}` : "新增用例");
  return result({ ok: true });
}

/** 把「测试记录（系统生成）」写进 PRD 末尾，发布成新的一版（PRD 已确认也照写，不影响确认的版本号） */
async function writeReport(session: SessionUser, d: Delivery, section: string) {
  const prd = await pageOrThrow(d.prdPageId);
  if (!prd) return;
  await publishVersion(session, prd.id, prd.title, withReport(prd.body, section), "写入测试记录");
}

const REPORT_TASK =
  "不执行测试，只根据下面给的这一轮执行结果写测试报告：最前面给出上线结论（建议上线 / 有条件上线 / 不建议上线 / 无法判定）和依据，再写执行统计、失败和阻塞用例、缺陷统计、遗留问题与风险、回归建议。数字只用给出的，不要编；结果里没有的信息写进「待确认问题」。";

/**
 * T35 用 skill 生成测试报告：{ runId, skillId?, credentialId?, model? }。
 * 只对已完成的一轮；结果写成 PRD（没有就是原始文档）下的一篇子页面「测试报告 · 第 N 轮」，再次生成发布成新版本。
 * 系统固定格式的「测试记录」仍写在 PRD 末尾，两者并存。
 */
async function skillReport(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const run = await prisma.deliveryRun.findFirst({ where: { id: String(body.runId || ""), deliveryId: d.id, kind: "round", status: "finalized" }, include: { results: true } });
  if (!run) throw new DeliveryError("这一轮还没完成，完成本轮后再生成测试报告", 400);
  const skillId = String(body.skillId || "builtin:test-report");
  const sk = await skillPrompt(session, skillId, REPORT_TASK);
  if (!sk) throw new DeliveryError("能力不存在", 404);
  const credentialId = String(body.credentialId || d.credentialId || "");
  const model = String(body.model || d.model || "");
  const use = await credentialForUse(session, credentialId, model);
  if ("error" in use) throw new DeliveryError(use.error || "模型不可用，请重新选择", 402);
  const [source, prd] = await Promise.all([pageOrThrow(d.sourcePageId), pageOrThrow(d.prdPageId)]);
  const { counts } = await import("./testing");
  const c = counts(run.results);
  const bugIds = run.results.map((r) => r.bugId).filter((x): x is string => Boolean(x));
  const bugs = bugIds.length ? await prisma.bug.findMany({ where: { id: { in: bugIds } }, select: { id: true, title: true, status: true, severity: true } }) : [];
  const bugOf = new Map(bugs.map((b) => [b.id, b]));
  const lines = run.results
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((r) => {
      const b = r.bugId ? bugOf.get(r.bugId) : null;
      return `- ${r.code} ${r.title}（${r.priority}，${r.mode === "manual" ? "手工" : "自动"}）：${r.voided ? "误报已取消" : r.status}${r.failedStep ? `，第 ${r.failedStep} 步` : ""}${r.message ? `，${r.message.slice(0, 200)}` : ""}${b ? `；Bug「${b.title}」${b.severity}/${b.status}` : ""}`;
    });
  const input = [
    `需求：${source?.title || "—"}；PRD：${prd?.title || "—"}`,
    `第 ${run.round} 轮（${run.scope === "failed" ? "只跑上轮失败" : run.scope === "single" ? "单条" : "全量"}），环境 ${run.envName || run.envUrl}，完成于 ${(run.finalizedAt || run.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    `统计：共 ${c.total} 条，通过 ${c.passed}，失败 ${c.failed}，阻塞 ${c.blocked}，跳过 ${c.skipped}，误报 ${c.voided}，通过率 ${c.rate}%`,
    "逐条结果：",
    ...lines,
  ].join("\n");
  let out;
  // T53：边写边放进实时正文，文档区实时显示
  liveStart(d.id, "report", `测试报告 · 第 ${run.round} 轮`);
  try {
    out = await chatStream(use.cred, model, sk.prompt + (await wikiStyleFor(session.id)), [{ role: "user", content: input.slice(0, 60_000) }], 8000, {
      idleMs: IDLE_STOP_MS,
      onDelta: (x) => {
        if (x.kind === "text") liveAppend(d.id, "report", x.text);
      },
    });
  } catch (e) {
    liveEnd(d.id, "report");
    throw new DeliveryError(`模型调用失败：${(e as Error).message}`, 502);
  }
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "skill", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  liveEnd(d.id, "report");
  const html = mdToHtml(stripFence(out.text));
  const title = `测试报告 · 第 ${run.round} 轮`;
  const existing = await pageOrThrow(run.reportPageId);
  // T54：对话里留一条，报告阶段按流程显示
  await prisma.deliveryMessage.create({ data: { deliveryId: d.id, stage: "report", role: "assistant", content: `第 ${run.round} 轮测试报告已${existing ? "重新" : ""}生成（${sk.name}）：共 ${c.total} 条，通过 ${c.passed}，失败 ${c.failed}，阻塞 ${c.blocked}，通过率 ${c.rate}%${bugs.length ? `，关联 Bug ${bugs.length} 个` : ""}。` } });
  if (existing) {
    await publishVersion(session, existing.id, existing.title, html, `重新生成测试报告（${sk.name}）`);
    return { pageId: existing.id };
  }
  const parentId = prd?.id || source?.id || null;
  const max = await prisma.docPage.aggregate({ where: { projectId: d.projectId, parentId }, _max: { sortOrder: true } });
  const page = await prisma.docPage.create({ data: { projectId: d.projectId, parentId, title, body: html, version: 1, publishedAt: new Date(), sortOrder: (max._max.sortOrder ?? -1) + 1, creatorId: session.id, updatedById: session.id } });
  await prisma.docPageVersion.create({ data: { pageId: page.id, version: 1, title, body: html, authorId: session.id } });
  await prisma.deliveryRun.update({ where: { id: run.id }, data: { reportPageId: page.id } });
  return { pageId: page.id };
}

/** 交付操作：{ action: "cases" | "message" | "suggestion" | "confirm" | "reopen" | "saveCase" | "testSetup" | "run" | "stop" | "manual" | "finalize" | "void", ... } */
export async function deliveryAction(session: SessionUser, id: string, body: Record<string, unknown>) {
  try {
    const d = await prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new DeliveryError("需求交付不存在", 404);
    await checkSpace(session, d.projectId, true);
    switch (body.action) {
      case "cases":
        return await startCases(session, d, body);
      case "message":
        return await chat(session, d, body);
      case "suggestion":
        return await suggestion(session, d, body);
      case "confirm":
        return await confirm(session, d, body);
      case "reopen":
        return await reopen(session, d, body);
      case "saveCase":
        return await saveCase(session, d, body);
      case "testSetup":
        await testSetup(d, body);
        return result({ ok: true });
      case "scripts":
        await saveScripts(d, body);
        return result({ ok: true });
      case "autoRun":
        await setAutoRun(session, d, body);
        return result({ ok: true });
      case "run":
        return result({ id: await startRun(session, d, body) });
      case "stopGenerate":
        await stopGenerate(d, body);
        return result({ ok: true });
      case "stop":
        await stopRun(d, body);
        return result({ ok: true });
      case "manual":
        await manualResult(d, body);
        return result({ ok: true });
      case "prototype":
        return await startPrototype(session, d, body);
      case "aiReview":
        return await startAiReview(session, d, body);
      case "manualBulk":
        return result({ ok: true, count: await manualBulk(d, body) });
      case "finalize":
        return result(await finalizeRun(session, d, body, (html) => writeReport(session, d, html)));
      case "void":
        return result({ voided: await voidRun(session, d, body, (html) => writeReport(session, d, html)) });
      case "report":
        return result(await skillReport(session, d, body));
      default:
        throw new DeliveryError("未知操作");
    }
  } catch (e) {
    return fail(e);
  }
}

export { listLocalRuns, getLocalRun, reportLocalResult, finishLocalRun, onRequirementReadyForTest } from "./testing";

/** 文档阅读页用：这篇页面在不在某个需求交付里、是哪个角色；用例页再带上覆盖情况 */
export async function deliveryBrief(pageId: string) {
  const v = await deliveryForView(pageId);
  const { d, report } = v;
  if (!d) return null;
  const role = pageId === d.prdPageId ? "prd" : pageId === d.casesPageId ? "cases" : report ? "report" : "review" in v && v.review ? "review" : "source";
  let coverageInfo: ReturnType<typeof coverage> | null = null;
  let basis: string | null = null;
  if (role === "cases") {
    const [prd, cases] = await Promise.all([pageOrThrow(d.prdPageId), pageOrThrow(d.casesPageId)]);
    if (prd && cases) {
      coverageInfo = coverage(featureCodes(prd.body), parseCasesBody(cases.body));
      basis = `依据「${prd.title}」第 ${d.casesBasisVersion ?? prd.version} 版${d.casesBasisVersion != null && d.prdConfirmedVersion != null && d.casesBasisVersion !== d.prdConfirmedVersion ? `（PRD 已改成第 ${d.prdConfirmedVersion} 版）` : ""}`;
    }
  }
  return { id: d.id, role, casesStatus: view(d).casesStatus, coverage: coverageInfo, basis };
}
