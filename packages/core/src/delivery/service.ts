import { randomUUID } from "node:crypto";
import { advanceRequirements, deliveryRequirements } from "../requirements/flow";
import { Prisma, type Delivery, type DocPage } from "@prisma/client";
import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { chatStream, isMaxTokensError, type ChatMessage } from "../ai/providers";
import { IDLE_STOP_MS, abortGeneration, begin, emptyReason, end, generate, Tracker, type GenWhat } from "./progress";
import { credentialForUse } from "../ai/credentials";
import { recordUsage } from "../ai/quota";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { docPlainText, escapeHtml, extractRefs } from "../shared/doc-html";
import { logDoc } from "../shared/docs-api";
import { bugWhere, getAccess, requirementWhere } from "../access";
import { skillPrompt } from "../skills/service";
import { ExtractError, attachmentsText } from "./extract";
import { featureItems, applyBlockOp, blockPreview, blocksForAi, featureCodes, mdToHtml, openQuestions, splitBlocks, stripFence } from "./blocks";
import { TestError, finalizeRun, manualResult, startRun, stopRun, testSetup, testView, voidRun, withReport } from "./testing";
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

async function deliveryFor(pageId: string) {
  return prisma.delivery.findFirst({ where: { OR: [{ sourcePageId: pageId }, { prdPageId: pageId }, { casesPageId: pageId }] } });
}

/** 生成进度：ageMs 用服务器时间算，避免浏览器时钟不准 */
function progressView(d: Delivery) {
  const p = d.jobProgress as Record<string, unknown> | null;
  if (!p || !(busy(d.prdStatus, d.jobStartedAt) || busy(d.casesStatus, d.jobStartedAt))) return null;
  const now = Date.now();
  return { ...p, ageMs: Math.max(0, now - new Date(String(p.lastAt)).getTime()), elapsedMs: Math.max(0, now - new Date(String(p.startedAt)).getTime()) };
}

function view(d: Delivery) {
  return {
    id: d.id,
    prdStatus: busy(d.prdStatus, d.jobStartedAt) || d.prdStatus !== "generating" ? d.prdStatus : d.prdPageId ? "draft" : "failed",
    casesStatus: busy(d.casesStatus, d.jobStartedAt) || d.casesStatus !== "generating" ? d.casesStatus : d.casesPageId ? "draft" : "failed",
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
    const d = await deliveryFor(page.id);
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
      role: page.id === d.prdPageId ? "prd" : page.id === d.casesPageId ? "cases" : "source",
      canEdit,
      canStart: canEdit,
      source: source ? { id: source.id, title: source.title, chars: docPlainText(source.body).replace(/\s/g, "").length } : null,
      prd: prd ? { ...pageInfo(prd), openQuestions: openQuestions(prd.body), features } : null,
      cases: cases ? { ...pageInfo(cases), summary: casesSummary(list), coverage: coverage(features, list) } : null,
      tests: d.casesPageId ? await testView(d) : null,
      messages: messages.map((m) => ({ id: m.id, stage: m.stage, role: m.role, content: m.content, suggestions: (m.suggestions as Suggestion[] | null)?.map(publicSuggestion) ?? [], createdAt: m.createdAt })),
    });
  } catch (e) {
    return fail(e);
  }
}

const publicSuggestion = (s: Suggestion) => ({ id: s.id, title: s.title, op: s.op, status: s.status, before: s.before, after: s.after, error: s.error });

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

async function ask(session: SessionUser, use: Use, model: string, system: string, messages: ChatMessage[], maxTokens: number) {
  // 流式收（推理模型的思考单独计数），输出上限给大一些，厂商不接受时退回原来的上限
  let out;
  try {
    out = await chatStream(use.cred, model, system, messages, Math.max(maxTokens, 16_000), { idleMs: IDLE_STOP_MS });
  } catch (e) {
    if (!isMaxTokensError((e as Error).message)) throw e;
    out = await chatStream(use.cred, model, system, messages, maxTokens, { idleMs: IDLE_STOP_MS });
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
  try {
    await tracker.set({ stage: "prepare" });
    const out = await generate(use.cred, model, prompt + PRD_FORMAT, [{ role: "user", content: input }], tracker, ctrl.signal);
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
  const what: GenWhat = body.what === "cases" ? "cases" : "prd";
  abortGeneration(d.id, what);
  // 本进程里没找到（比如服务重启过）也把状态改回来
  if (what === "prd") await prisma.delivery.updateMany({ where: { id: d.id, prdStatus: "generating" }, data: { prdStatus: d.prdPageId ? "draft" : "none", error: "生成 PRD 已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
  else await prisma.delivery.updateMany({ where: { id: d.id, casesStatus: "generating" }, data: { casesStatus: d.casesPageId ? "draft" : "none", error: "生成测试用例已停止：你停止了生成", jobStartedAt: null, jobProgress: Prisma.DbNull } });
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
    system = `${PRD_CHAT}\n\nPRD「${page.title}」当前内容：\n${blocksForAi(blocks)}`;
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
    text = await ask(session, use, model, system, msgs, 6000);
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
      case "finalize":
        return result(await finalizeRun(session, d, body, (html) => writeReport(session, d, html)));
      case "void":
        return result({ voided: await voidRun(session, d, body, (html) => writeReport(session, d, html)) });
      default:
        throw new DeliveryError("未知操作");
    }
  } catch (e) {
    return fail(e);
  }
}

export { listLocalRuns, getLocalRun, reportLocalResult, finishLocalRun } from "./testing";

/** 文档阅读页用：这篇页面在不在某个需求交付里、是哪个角色；用例页再带上覆盖情况 */
export async function deliveryBrief(pageId: string) {
  const d = await deliveryFor(pageId);
  if (!d) return null;
  const role = pageId === d.prdPageId ? "prd" : pageId === d.casesPageId ? "cases" : "source";
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
