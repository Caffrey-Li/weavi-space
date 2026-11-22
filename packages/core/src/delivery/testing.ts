import type { Delivery, DeliveryResult, DeliveryRun } from "@prisma/client";
import { advanceRequirements, deliveryRequirements } from "../requirements/flow";
import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { Prisma } from "@prisma/client";
import { escapeHtml, sanitizeDocHtml } from "../shared/doc-html";
import { sealText } from "../shared/secure-config";
import { parseCasesBody, stepText, type TestCase } from "../shared/testcases";
import { bugCodeOf } from "../docs/docs-query";
import { POST as createBug } from "../bugs/index";
import { PATCH as setBugStatus } from "../bugs/id-status";
import { POST as addBugComment } from "../bugs/id-comments";
import { docPlainText } from "../shared/doc-html";
import { splitBlocks, joinBlocks } from "./blocks";
import { kickRunner } from "./runner";

/**
 * 需求交付 · 测试（T24 第二期）：测试环境与账号、发起一轮 / 试跑、停止、填手工结果、完成本轮（提 Bug + 写测试记录）、误报一键取消。
 * Bug 去重：一条用例最多对应一个未关闭的 Bug；再次失败只追加备注（已解决的改成重新打开）；回归通过的关闭。
 */

export class TestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const SEVERITY: Record<string, string> = { P0: "critical", P1: "major", P2: "minor", P3: "trivial" };
const OPEN = ["open", "in_progress", "reopened"];
const ACTIVE = ["queued", "running", "stopping", "manual", "done"];
const BUG_LABEL: Record<string, string> = { open: "待处理", in_progress: "处理中", resolved: "已解决", closed: "已关闭", reopened: "重新打开", cancelled: "已取消" };

type Env = { name: string; url: string };

/** 测试环境候选：项目所属产品的「产品环境」里的 http(s) 地址 */
export async function envOptions(projectId: string): Promise<Env[]> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { product: { select: { name: true, environments: true } } } });
  if (!p?.product?.environments) return [];
  let list: { name?: string; urls?: { label?: string; url?: string }[] }[] = [];
  try {
    list = JSON.parse(p.product.environments);
  } catch {
    return [];
  }
  const out: Env[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    for (const u of Array.isArray(e.urls) ? e.urls : []) {
      const url = String(u.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      try {
        new URL(url);
      } catch {
        continue;
      }
      out.push({ name: [p.product.name, e.name, u.label].filter(Boolean).join(" · "), url });
    }
  }
  return out;
}

export async function testSetup(d: Delivery, body: Record<string, unknown>) {
  const url = String(body.envUrl || "");
  const env = (await envOptions(d.projectId)).find((e) => e.url === url);
  if (!env) throw new TestError("请选择产品环境里登记过的地址（项目所属产品 · 产品环境）");
  const data: Record<string, unknown> = { envUrl: env.url, envName: env.name, testUser: String(body.testUser || "").trim().slice(0, 100) || null };
  const pass = typeof body.testPass === "string" ? body.testPass : "";
  if (pass) data.testPassEnc = sealText(pass.slice(0, 200));
  if (body.clearPass === true) data.testPassEnc = null;
  // T55 自动登录 + 按前置条件换账号
  if (body.login !== undefined) {
    const { cleanLoginInput, parseLoginConfig } = await import("./login-config");
    try {
      const cfg = cleanLoginInput(body.login, parseLoginConfig(d.loginConfig));
      data.loginConfig = cfg ? (cfg as unknown as Prisma.InputJsonObject) : Prisma.DbNull;
    } catch (e) {
      throw new TestError((e as Error).message);
    }
  }
  await prisma.delivery.update({ where: { id: d.id }, data });
}

/**
 * 测试脚本（T39；T54 加来源）：
 * - upload（默认）：上传的文本文件，存 content；
 * - local：本机路径（本机 Agent 在自己电脑上读这个文件）；
 * - url：其他地址（http(s)，本机 Agent 自己下载）；
 * - doc：系统里的文档（用例页 → 按用例生成的 Playwright 脚本；普通文档 → 页面里的代码块），领取时按最新内容生成。
 * 服务器上的执行器都不运行这些脚本。
 */
export type ScriptKind = "upload" | "local" | "url" | "doc";
export type TestScript = { name: string; content: string; kind?: ScriptKind; path?: string; url?: string; pageId?: string };
const SCRIPT_EXT = /\.(spec|test)?\.?(ts|js|mjs|cjs|py|yaml|yml|json|md|txt)$/i;

/**
 * 最多 10 个，上传的每个 ≤ 200 KB、合计 ≤ 1 MB，名称只允许字母数字中文 . _ -。
 * 脚本只交给「在我的电脑执行」的本机 Agent（MCP delivery_get_test_run 返回），服务器上的执行器不运行任何脚本。
 */
export function cleanScripts(raw: unknown): TestScript[] {
  if (!Array.isArray(raw)) throw new TestError("脚本格式不对");
  if (raw.length > 10) throw new TestError("脚本最多 10 个");
  const out: TestScript[] = [];
  let total = 0;
  for (const f of raw as Record<string, unknown>[]) {
    const kind: ScriptKind = f?.kind === "local" || f?.kind === "url" || f?.kind === "doc" ? f.kind : "upload";
    const name = String(f?.name || "").trim().slice(0, 100);
    if (!name || !/^[\w\u4e00-\u9fa5.\-· /:]+$/.test(name) || name.startsWith(".")) throw new TestError(`名称不合法：${name || "（空）"}`);
    if (out.some((x) => x.name === name)) throw new TestError(`重名：${name}`);
    if (kind === "upload") {
      const content = typeof f?.content === "string" ? f.content : "";
      if (!/^[\w\u4e00-\u9fa5.\- ]+$/.test(name) || !SCRIPT_EXT.test(name)) throw new TestError(`文件名不合法：${name}（支持 .ts / .js / .py / .yaml / .json / .md / .txt）`);
      if (content.length > 200_000) throw new TestError(`${name} 超过 200 KB`);
      total += content.length;
      out.push({ name, content, kind });
    } else if (kind === "local") {
      const path = String(f?.path || "").trim();
      if (!path || path.length > 500 || /[\0\n\r]/.test(path)) throw new TestError("本机路径不对");
      out.push({ name, content: "", kind, path });
    } else if (kind === "url") {
      const url = String(f?.url || "").trim();
      if (!/^https?:\/\/[^\s]{3,}$/i.test(url) || url.length > 1000) throw new TestError("地址要以 http:// 或 https:// 开头");
      out.push({ name, content: "", kind, url });
    } else {
      const pageId = String(f?.pageId || "").trim();
      if (!/^[a-z0-9]{10,40}$/i.test(pageId)) throw new TestError("请选择系统里的文档");
      out.push({ name, content: "", kind, pageId });
    }
  }
  if (total > 1_000_000) throw new TestError("脚本合计超过 1 MB");
  return out;
}

export const scriptList = (raw: unknown): TestScript[] => (Array.isArray(raw) ? (raw as TestScript[]).filter((x) => x && typeof x.name === "string" && (typeof x.content === "string" || x.kind)) : []);

/** 文档来源的脚本：用例页按最新用例生成 Playwright；普通文档取页面里的代码块 */
async function docScript(pageId: string, projectId: string, baseUrl: string) {
  const p = await prisma.docPage.findFirst({ where: { id: pageId, deletedAt: null }, select: { title: true, kind: true, body: true, projectId: true } });
  if (!p) return "// 文档已删除";
  if (p.kind === "testcases") {
    const { toPlaywright } = await import("../shared/testcases");
    return toPlaywright(parseCasesBody(p.body), p.title, baseUrl);
  }
  void projectId;
  const blocks = [...String(p.body || "").matchAll(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  return blocks.join("\n\n") || "// 这篇文档里没有代码块";
}

/** 给本机 Agent 的脚本清单：文档来源的按最新内容生成 */
async function scriptsForAgent(raw: unknown, projectId: string, baseUrl: string) {
  const list = scriptList(raw);
  return Promise.all(
    list.map(async (x) => {
      const kind = x.kind || "upload";
      if (kind === "doc") return { name: x.name, kind, pageId: x.pageId, content: await docScript(x.pageId || "", projectId, baseUrl) };
      if (kind === "local") return { name: x.name, kind, path: x.path, content: "", note: "本机路径：在你的电脑上读取这个文件执行" };
      if (kind === "url") return { name: x.name, kind, url: x.url, content: "", note: "其他地址：在你的电脑上下载后执行（需要的话用你本机的凭据）" };
      return { name: x.name, kind, content: x.content };
    }),
  );
}

/** 保存脚本：{ scripts } 整体替换；{ add: [...] } 追加（同名覆盖）；{ remove: name } 删一个 */
export async function saveScripts(d: Delivery, body: Record<string, unknown>) {
  const now = scriptList(d.scripts);
  let next: unknown = body.scripts;
  if (body.add !== undefined) {
    const add = Array.isArray(body.add) ? (body.add as TestScript[]) : [];
    next = [...now.filter((x) => !add.some((a) => a?.name === x.name)), ...add];
  } else if (body.remove !== undefined) next = now.filter((x) => x.name !== String(body.remove));
  const scripts = cleanScripts(next ?? []);
  // 文档来源只能选本企业的文档
  const docIds = scripts.filter((x) => x.kind === "doc").map((x) => x.pageId!);
  if (docIds.length) {
    const own = await prisma.project.findUnique({ where: { id: d.projectId }, select: { enterpriseId: true } });
    const pages = await prisma.docPage.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true, project: { select: { enterpriseId: true } } } });
    if (pages.length !== new Set(docIds).size || pages.some((p) => p.project.enterpriseId !== own?.enterpriseId)) throw new TestError("只能选本企业里的文档");
  }
  await prisma.delivery.update({ where: { id: d.id }, data: { scripts: scripts.length ? scripts : Prisma.DbNull } });
}

/** 提测自动执行：{ autoRun: "off" | "server" | "local" }；开启时记下开启人，自动发起时用他的身份 */
export async function setAutoRun(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  const v = ["server", "local"].includes(String(body.autoRun)) ? String(body.autoRun) : "off";
  if (v !== "off" && !d.envUrl) throw new TestError("先选择测试环境，再开启自动执行");
  await prisma.delivery.update({ where: { id: d.id }, data: { autoRun: v, autoRunById: v === "off" ? null : session.id } });
}

/**
 * T39 提测触发：需求状态变成「待测试」时调用。找关联的需求交付（以这条需求的主文档为原始文档，或它是 PRD 拆出的实现需求），
 * 开了自动执行、用例已确认、选了环境、没有进行中的一轮，就以开启人的身份发起一轮全量测试，并通知开启人。
 * 开启人停用、是体验账号、或已没有编辑权限时跳过。
 */
export async function onRequirementReadyForTest(requirementId: string) {
  const req = await prisma.requirement.findUnique({ where: { id: requirementId }, select: { id: true, title: true, docPageId: true } });
  if (!req) return 0;
  const candidates = await prisma.delivery.findMany({ where: { autoRun: { in: ["server", "local"] }, casesStatus: "confirmed" } });
  const hits = candidates.filter((d) => d.sourcePageId === req.docPageId || Object.values((d.featureReqs as Record<string, string> | null) ?? {}).includes(req.id));
  let n = 0;
  for (const d of hits) {
    if (!d.autoRunById || !d.envUrl || (await activeRound(d.id))) continue;
    const u = await prisma.user.findUnique({ where: { id: d.autoRunById }, select: { id: true, email: true, name: true, globalRole: true, avatarUrl: true, isActive: true, isDemo: true } });
    if (!u?.isActive || u.isDemo) continue;
    const owner: SessionUser = { id: u.id, email: u.email, name: u.name, globalRole: u.globalRole, avatarUrl: u.avatarUrl };
    const { canEditDocs } = await import("../docs/docs-query");
    if (!(await canEditDocs(owner, d.projectId))) continue;
    try {
      const runId = await startRun(owner, d, { kind: "round", scope: "all", executor: d.autoRun });
      n++;
      await prisma.notification.create({ data: { userId: owner.id, kind: "system", title: `已自动发起测试：${req.title}`.slice(0, 200), body: d.autoRun === "local" ? "需求进入「待测试」，已排好一轮测试，等你电脑上的 Agent 领取（MCP delivery_list_test_runs）。" : "需求进入「待测试」，服务器已开始按用例执行。", href: `/docs/${d.projectId}/pages/${d.sourcePageId}`, entityType: "delivery_run", entityId: runId } });
    } catch (e) {
      console.error("[需求交付] 提测自动执行失败", e instanceof Error ? e.message : e);
    }
  }
  return n;
}

async function activeRound(deliveryId: string) {
  return prisma.deliveryRun.findFirst({ where: { deliveryId, kind: "round", status: { in: ACTIVE } }, orderBy: { createdAt: "desc" } });
}

/** 发起：{ kind: "round" | "trial", scope?: "all" | "failed", code?（试跑） } */
const ORDER_REQ = ["req_in_progress", "req_done", "req_design", "dev_todo", "dev_in_progress", "dev_done", "test_todo", "test_in_progress", "test_done", "online"];

/** 交付关联的需求（主需求文档是原始文档的业务需求 + PRD 拆出的实现需求）的开发情况：都到「开发完成」及以后才算开发完成 */
export async function devState(d: Delivery) {
  const { owners, kids } = await deliveryRequirements(d.sourcePageId, d.featureReqs);
  const ids = Array.from(new Set([...owners, ...kids]));
  if (!ids.length) return { ready: true, items: [] as { id: string; code: string; title: string; status: string; label: string; done: boolean }[] };
  const { reqCodeOf } = await import("../shared/codes");
  const { reqStatusLabel } = await import("../shared/constants");
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids }, deletedAt: null, status: { not: "cancelled" } }, select: { id: true, number: true, title: true, status: true } });
  const items = rows.map((r) => ({ id: r.id, code: reqCodeOf(r), title: r.title, status: r.status, label: reqStatusLabel(r.status), done: ORDER_REQ.indexOf(r.status) >= ORDER_REQ.indexOf("dev_done") }));
  // 有实现需求时看实现需求；没有就看业务需求
  const scope = kids.length ? items.filter((x) => kids.includes(x.id)) : items;
  return { ready: !scope.length || scope.every((x) => x.done), items };
}

export async function startRun(session: SessionUser, d: Delivery, body: Record<string, unknown>) {
  if (!d.envUrl) throw new TestError("先选择测试环境");
  if (!(await envOptions(d.projectId)).some((e) => e.url === d.envUrl)) throw new TestError("测试环境已不在产品环境里，请重新选择");
  const page = d.casesPageId ? await prisma.docPage.findUnique({ where: { id: d.casesPageId } }) : null;
  const all = parseCasesBody(page?.body || "");
  const kind = body.kind === "trial" ? "trial" : "round";
  const executor = kind === "round" && body.executor === "local" ? "local" : "server";
  let cases: TestCase[];
  let round = 0;
  let scope = "single";
  if (kind === "trial") {
    const c = all.find((x) => x.code === String(body.code || ""));
    if (!c) throw new TestError("用例不存在", 404);
    if (c.mode !== "auto") throw new TestError("手工用例不能试跑");
    if (await prisma.deliveryRun.findFirst({ where: { deliveryId: d.id, kind: "trial", status: { in: ["queued", "running"] } } })) throw new TestError("上一条试跑还没结束");
    cases = [c];
  } else {
    if (d.casesStatus !== "confirmed") throw new TestError("先确认测试用例，再发起测试");
    // T58：用例确认后是完结点，需求开发完成（进入「开发完成」及以后）才能正式测试；试跑不限
    const dev = await devState(d);
    if (!dev.ready) {
      const left = dev.items.filter((x) => !x.done).map((x) => `${x.code}「${x.label}」`).slice(0, 3).join("、");
      throw new TestError(`需求还没开发完成（${left}）：开发完成后再正式测试，现在可以先试跑单条用例`);
    }
    if (await activeRound(d.id)) throw new TestError("这一轮还没完成：先完成或停止当前这一轮");
    const last = await prisma.deliveryRun.findFirst({ where: { deliveryId: d.id, kind: "round", status: "finalized" }, include: { results: true }, orderBy: { round: "desc" } });
    scope = body.scope === "failed" && last ? "failed" : "all";
    if (scope === "failed") {
      const bad = new Set(last!.results.filter((r) => !r.voided && (r.status === "failed" || r.status === "blocked")).map((r) => r.code));
      cases = all.filter((c) => bad.has(c.code));
      if (!cases.length) throw new TestError("上一轮没有失败的用例，请选「全量」");
    } else cases = all;
    if (!cases.length) throw new TestError("没有用例");
    const max = await prisma.deliveryRun.aggregate({ where: { deliveryId: d.id, kind: "round" }, _max: { round: true } });
    round = (max._max.round ?? 0) + 1;
  }
  const run = await prisma.deliveryRun.create({
    data: {
      deliveryId: d.id,
      kind,
      round,
      scope,
      envName: d.envName,
      envUrl: d.envUrl,
      executor,
      total: executor === "local" ? cases.length : cases.filter((c) => c.mode === "auto").length,
      createdById: session.id,
      results: { create: cases.map((c) => ({ code: c.code, title: c.title, priority: c.priority, mode: c.mode })) },
    },
  });
  if (kind === "round") {
    const { owners, kids } = await deliveryRequirements(d.sourcePageId, d.featureReqs);
    await advanceRequirements(session.id, [...owners, ...kids], "test_in_progress", `需求交付发起第 ${round} 轮测试`);
  }
  if (executor === "server") void kickRunner();
  return run.id;
}

async function runOf(d: Delivery, runId: unknown) {
  const run = await prisma.deliveryRun.findFirst({ where: { id: String(runId || ""), deliveryId: d.id }, include: { results: true } });
  if (!run) throw new TestError("这一轮不存在", 404);
  return run;
}

export async function stopRun(d: Delivery, body: Record<string, unknown>) {
  const run = await runOf(d, body.runId);
  if (run.status === "queued") await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "stopped", finishedAt: new Date() } });
  else if (run.status === "running") await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "stopping" } });
  else if (run.status === "manual" || run.status === "done") await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "stopped" } });
  else throw new TestError("这一轮已经结束");
}

/** 手工用例结果：{ runId, code, status: passed | failed, note? } */
export async function manualResult(d: Delivery, body: Record<string, unknown>) {
  const run = await runOf(d, body.runId);
  if (!["running", "manual", "done"].includes(run.status)) throw new TestError("这一轮已经结束");
  const r = run.results.find((x) => x.code === String(body.code || ""));
  if (!r || r.mode !== "manual") throw new TestError("手工用例不存在", 404);
  const status = body.status === "failed" ? "failed" : body.status === "passed" ? "passed" : "pending";
  const img = status === "failed" ? imageOf(body.screenshotBase64) : null;
  const att = img ? await prisma.attachment.create({ data: { ownerType: "delivery_run", ownerId: run.id, name: `${r.code}-人工.${img.mime === "image/png" ? "png" : "jpg"}`, mime: img.mime, size: img.data.length, data: img.data, uploaderId: run.createdById } }) : null;
  await prisma.deliveryResult.update({ where: { id: r.id }, data: { status, note: String(body.note || "").trim().slice(0, 500) || null, message: status === "failed" ? String(body.note || "").trim().slice(0, 500) || "人工判定失败" : null, ...(att ? { screenshotId: att.id } : status !== "failed" ? { screenshotId: null } : {}) } });
  const pending = await prisma.deliveryResult.count({ where: { runId: run.id, status: "pending" } });
  if (run.status === "manual" && !pending) await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "done" } });
  if (run.status === "done" && pending) await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "manual" } });
}

/** T57 手工用例批量给结论：{ runId, status: "passed" | "skipped" }，只改还没给结论的 */
export async function manualBulk(d: Delivery, body: Record<string, unknown>) {
  const run = await runOf(d, body.runId);
  if (!["running", "manual", "done"].includes(run.status)) throw new TestError("这一轮已经结束");
  const status = body.status === "passed" ? "passed" : body.status === "skipped" ? "skipped" : null;
  if (!status) throw new TestError("参数不对");
  const done = await prisma.deliveryResult.updateMany({ where: { runId: run.id, mode: "manual", status: "pending" }, data: { status, note: status === "passed" ? "批量标为通过" : "批量标为跳过" } });
  const pending = await prisma.deliveryResult.count({ where: { runId: run.id, status: "pending" } });
  if (run.status === "manual" && !pending) await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "done" } });
  return done.count;
}

const unwrap = (r: { body: unknown; init?: { status?: number } }) => {
  if (r.init?.status && r.init.status >= 400) throw new TestError(String((r.body as { error?: string })?.error || "操作失败"), r.init.status);
  return r.body as Record<string, unknown>;
};

/** 某条用例最近一次关联的 Bug（只看完成的正式轮、没被标误报的） */
async function lastBug(deliveryId: string, code: string, beforeRound: number) {
  const r = await prisma.deliveryResult.findFirst({ where: { code, bugId: { not: null }, voided: false, run: { deliveryId, kind: "round", status: "finalized", round: { lt: beforeRound } } }, orderBy: { run: { round: "desc" } } });
  if (!r?.bugId) return null;
  return prisma.bug.findUnique({ where: { id: r.bugId }, select: { id: true, status: true, deletedAt: true, archivedAt: true } });
}

function bugHtml(d: Delivery, run: DeliveryRun, r: DeliveryResult, c: TestCase | undefined) {
  const steps = (c?.steps || []).map((s, i) => `<li>${escapeHtml(stepText(s))}${r.failedStep === i + 1 ? " ← 这一步出错" : ""}</li>`).join("");
  return sanitizeDocHtml(
    [
      `<p><strong>需求交付自动测试</strong> · 第 ${run.round} 轮 · ${escapeHtml(run.envName || "")} ${escapeHtml(run.envUrl)}</p>`,
      `<p>用例：${escapeHtml(`${r.code} ${r.title}`)}（${escapeHtml(c?.feature || "—")} · ${escapeHtml(r.priority)} · ${r.mode === "auto" ? "自动" : "手工"}）</p>`,
      c?.precondition ? `<p>前置条件：${escapeHtml(c.precondition)}</p>` : "",
      steps ? `<p>复现步骤：</p><ol>${steps}</ol>` : "",
      c?.expected ? `<p>预期：${escapeHtml(c.expected)}</p>` : "",
      `<p>实际：${escapeHtml(r.message || "失败")}</p>`,
      r.screenshotId ? `<p><img src="/api/attachments/${r.screenshotId}" alt="失败截图"></p>` : "",
      d.casesPageId ? `<p>用例页：<a href="/docs/${d.projectId}/pages/${d.casesPageId}">测试用例</a></p>` : "",
    ].join(""),
  );
}

/** 写进文档的时间：按服务器本机时间，不写死时区 */
const fmt = (t: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.month} 月 ${p.day} 日 ${p.hour}:${p.minute}`;
};

/** 完成本轮：失败的提 Bug / 追加备注 / 重新打开，通过的关闭对应 Bug，然后重写 PRD 末尾的测试记录 */
export async function finalizeRun(session: SessionUser, d: Delivery, body: Record<string, unknown>, writeReport: (html: string) => Promise<void>) {
  const run = await runOf(d, body.runId);
  if (run.kind !== "round") throw new TestError("试跑不需要完成");
  if (run.status !== "done" && run.status !== "manual") throw new TestError("这一轮还没跑完");
  const claimed = await prisma.deliveryRun.updateMany({ where: { id: run.id, status: { in: ["done", "manual"] } }, data: { status: "finalizing" } });
  if (!claimed.count) throw new TestError("正在处理，请稍候", 409);
  // T57：没给结论的手工用例不再拦着，确认本轮时记为跳过（未执行）
  const pendingIds = run.results.filter((r) => r.status === "pending").map((r) => r.id);
  if (pendingIds.length) {
    await prisma.deliveryResult.updateMany({ where: { id: { in: pendingIds } }, data: { status: "skipped", note: "未人工执行，确认本轮时记为跳过" } });
    for (const r of run.results) if (pendingIds.includes(r.id)) Object.assign(r, { status: "skipped", note: "未人工执行，确认本轮时记为跳过" });
  }
  try {
    const page = d.casesPageId ? await prisma.docPage.findUnique({ where: { id: d.casesPageId } }) : null;
    const cases = new Map(parseCasesBody(page?.body || "").map((c) => [c.code, c]));
    for (const r of run.results) {
      const prev = await lastBug(d.id, r.code, run.round);
      const alive = prev && !prev.deletedAt && !prev.archivedAt && prev.status !== "closed" && prev.status !== "cancelled" ? prev : null;
      if (r.status === "failed") {
        if (alive) {
          if (alive.status === "resolved") unwrap(await setBugStatus(session, { id: alive.id }, { status: "reopened" }));
          unwrap(await addBugComment(session, { id: alive.id }, { body: `<p>第 ${run.round} 轮测试再次失败：${escapeHtml(r.message || "")}</p>${r.screenshotId ? `<p><img src="/api/attachments/${r.screenshotId}" alt="失败截图"></p>` : ""}` }));
          await prisma.deliveryResult.update({ where: { id: r.id }, data: { bugId: alive.id } });
        } else {
          const c = cases.get(r.code);
          const reqId = c?.feature ? ((d.featureReqs as Record<string, string> | null) ?? {})[c.feature] : undefined;
          const linked = reqId ? await prisma.requirement.findFirst({ where: { id: reqId, deletedAt: null }, select: { id: true } }) : null;
          const out = unwrap(await createBug(session, { title: `[${r.code}] ${r.title} 测试失败`.slice(0, 200), projectId: d.projectId, ...(linked ? { requirementId: linked.id } : {}), severity: SEVERITY[r.priority] || "major", environment: "test", descriptionHtml: bugHtml(d, run, r, c) }));
          await prisma.deliveryResult.update({ where: { id: r.id }, data: { bugId: String(out.id), bugCreated: true } });
        }
      } else if (r.status === "passed" && alive) {
        unwrap(await setBugStatus(session, { id: alive.id }, { status: "closed" }));
        unwrap(await addBugComment(session, { id: alive.id }, { body: `<p>第 ${run.round} 轮回归通过，自动关闭。</p>` }));
        await prisma.deliveryResult.update({ where: { id: r.id }, data: { bugId: alive.id } });
      }
    }
    await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "finalized", finalizedAt: new Date() } });
  } catch (e) {
    await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "done" } });
    throw e;
  }
  await writeReport(await reportHtml(d.id));
  const s = counts((await prisma.deliveryResult.findMany({ where: { runId: run.id } })) as DeliveryResult[]);
  if (!s.failed && !s.blocked && !s.pending) {
    const { owners, kids } = await deliveryRequirements(d.sourcePageId, d.featureReqs);
    await advanceRequirements(session.id, [...owners, ...kids], "test_done", `第 ${run.round} 轮测试全部通过`);
  }
  return s;
}

/** 误报一键取消：本轮新提的 Bug 改成「已取消」，结果标成误报，重写测试记录 */
export async function voidRun(session: SessionUser, d: Delivery, body: Record<string, unknown>, writeReport: (html: string) => Promise<void>) {
  const run = await runOf(d, body.runId);
  if (run.status !== "finalized") throw new TestError("只有完成的一轮可以取消误报");
  const created = run.results.filter((r) => r.bugCreated && r.bugId && !r.voided);
  if (!created.length) throw new TestError("这一轮没有新提的 Bug");
  for (const r of created) {
    const b = await prisma.bug.findUnique({ where: { id: r.bugId! }, select: { status: true } });
    if (b && b.status !== "cancelled") {
      unwrap(await setBugStatus(session, { id: r.bugId! }, { status: "cancelled" }));
      unwrap(await addBugComment(session, { id: r.bugId! }, { body: "<p>测试误报，已在需求交付里取消。</p>" }));
    }
    await prisma.deliveryResult.update({ where: { id: r.id }, data: { voided: true } });
  }
  await writeReport(await reportHtml(d.id));
  return created.length;
}

export function counts(results: Pick<DeliveryResult, "status" | "voided">[]) {
  const c = { total: results.length, passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0, voided: 0 };
  for (const r of results) {
    if (r.voided) {
      c.voided++;
      c.passed++;
      continue;
    }
    c[r.status as "passed" | "failed" | "blocked" | "skipped" | "pending"]++;
  }
  return { ...c, rate: c.total ? Math.round((c.passed / c.total) * 100) : 0 };
}

const SCOPE_LABEL: Record<string, string> = { all: "全量", failed: "只跑上轮失败" };

/** PRD 末尾「测试记录（系统生成）」整节：所有完成的正式轮，新的在前 */
export async function reportHtml(deliveryId: string) {
  const runs = await prisma.deliveryRun.findMany({ where: { deliveryId, kind: "round", status: "finalized" }, include: { results: true }, orderBy: { round: "desc" } });
  const parts = [`<h2>测试记录（系统生成）</h2>`, `<p>每轮测试完成后由系统写入，数字由系统统计；表格里的 Bug 状态随 Bug 清单实时更新。</p>`];
  for (const run of runs) {
    const c = counts(run.results);
    const bad = run.results.filter((r) => !r.voided && (r.status === "failed" || r.status === "blocked"));
    const failedHigh = run.results.filter((r) => !r.voided && r.status === "failed" && (r.priority === "P0" || r.priority === "P1"));
    const verdict = failedHigh.length
      ? `不建议上线：${failedHigh.map((r) => `${r.priority} 用例 ${r.code}`).join("、")} 失败。`
      : c.failed
        ? `有条件上线：${c.failed} 条低优先级用例失败，确认影响后再决定。`
        : c.blocked
          ? `测试未完成：${c.blocked} 条用例阻塞（环境不可用或超时），检查环境后回归。`
          : c.skipped
            ? `基本通过：${c.skipped} 条用例跳过，建议补测。`
            : "测试通过，可以上线。";
    parts.push(`<h3>第 ${run.round} 轮 · ${fmt(run.finalizedAt || run.createdAt)} · ${escapeHtml(run.envName || run.envUrl)} · ${SCOPE_LABEL[run.scope] || ""}</h3>`);
    parts.push(`<p>共 ${c.total} 条：通过 ${c.passed} · 失败 ${c.failed} · 阻塞 ${c.blocked}${c.skipped ? ` · 跳过 ${c.skipped}` : ""}，通过率 ${c.rate}%${c.voided ? `（含误报已取消 ${c.voided} 条）` : ""}</p>`);
    if (bad.length) {
      const rows = bad
        .map((r) => `<tr><td>${escapeHtml(`${r.code} ${r.title}`)}</td><td>${r.status === "blocked" ? "阻塞：" : ""}${escapeHtml((r.message || "").slice(0, 160))}</td><td>${r.bugId ? `<a class="doc-ref" data-ref-kind="bug" data-ref-id="${r.bugId}">${bugCodeOf(r.bugId)}</a>` : "—"}</td></tr>`)
        .join("");
      parts.push(`<table><thead><tr><th>用例</th><th>失败原因</th><th>Bug</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    parts.push(`<p><strong>结论：</strong>${escapeHtml(verdict)}</p>`);
  }
  return parts.join("");
}

/** 把测试记录写进 PRD 正文：替换已有的「测试记录（系统生成）」一节，没有就追加到末尾 */
export function withReport(prdHtml: string, section: string) {
  const blocks = splitBlocks(prdHtml);
  const at = blocks.findIndex((b) => /^<h2\b/.test(b) && docPlainText(b).includes("测试记录（系统生成）"));
  const keep = at >= 0 ? blocks.slice(0, at) : blocks;
  return joinBlocks([...keep, ...splitBlocks(section)]);
}

// ---------- 面板数据 ----------

function runView(run: DeliveryRun & { results: DeliveryResult[] }) {
  return {
    id: run.id,
    kind: run.kind,
    executor: run.executor,
    claimedAt: run.claimedAt,
    round: run.round,
    scope: run.scope,
    status: run.status,
    envName: run.envName,
    envUrl: run.envUrl,
    total: run.total,
    doneCount: run.doneCount,
    currentCode: run.currentCode,
    currentStep: run.currentStep,
    error: run.error,
    createdAt: run.createdAt,
    finalizedAt: run.finalizedAt,
    reportPageId: run.reportPageId,
    counts: counts(run.results),
    results: run.results
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
      .map((r) => ({ code: r.code, title: r.title, priority: r.priority, mode: r.mode, status: r.status, failedStep: r.failedStep, message: r.message, screenshotUrl: r.screenshotId ? `/api/attachments/${r.screenshotId}` : null, durationMs: r.durationMs, bugId: r.bugId, bugCreated: r.bugCreated, voided: r.voided, note: r.note })),
  };
}

export async function testView(d: Delivery) {
  void kickRunner();
  const [envs, active, trial, rounds] = await Promise.all([
    envOptions(d.projectId),
    prisma.deliveryRun.findFirst({ where: { deliveryId: d.id, kind: "round", status: { in: [...ACTIVE, "finalizing"] } }, include: { results: true }, orderBy: { createdAt: "desc" } }),
    prisma.deliveryRun.findFirst({ where: { deliveryId: d.id, kind: "trial" }, include: { results: true }, orderBy: { createdAt: "desc" } }),
    prisma.deliveryRun.findMany({ where: { deliveryId: d.id, kind: "round", status: "finalized" }, include: { results: true }, orderBy: { round: "desc" }, take: 20 }),
  ]);
  const latest = rounds[0];
  const bugIds = Array.from(new Set(rounds.flatMap((r) => r.results.map((x) => x.bugId).filter(Boolean) as string[])));
  const bugs = bugIds.length ? await prisma.bug.findMany({ where: { id: { in: bugIds } }, select: { id: true, title: true, status: true, reopenCount: true } }) : [];
  const bugMap = new Map(bugs.map((b) => [b.id, { ...b, code: bugCodeOf(b.id), label: BUG_LABEL[b.status] || b.status }]));
  const latestBugs = latest ? Array.from(new Set(latest.results.filter((r) => r.bugId && !r.voided).map((r) => r.bugId!))).map((id) => bugMap.get(id)).filter(Boolean) : [];
  const latestCounts = latest ? counts(latest.results) : null;
  const passed = latestCounts && latestCounts.failed === 0 && latestCounts.blocked === 0 && latestCounts.pending === 0;
  const openBugs = latestBugs.filter((b) => b && OPEN.includes(b.status)).length;
  const state = active ? "running" : !latest ? "none" : passed ? "passed" : openBugs ? "fixing" : "retest";
  return {
    envOptions: envs,
    envName: d.envName,
    envUrl: d.envUrl,
    testUser: d.testUser,
    hasPass: Boolean(d.testPassEnc),
    scripts: scriptList(d.scripts).map((x) => ({ name: x.name, size: (x.content || "").length, kind: x.kind || "upload", path: x.path, url: x.url, pageId: x.pageId })),
    casesPageId: d.casesPageId,
    dev: await devState(d),
    login: (await import("./login-config")).loginView((await import("./login-config")).parseLoginConfig(d.loginConfig)),
    autoRun: d.autoRun,
    state,
    openBugs,
    active: active ? runView(active) : null,
    trial: trial ? runView(trial) : null,
    rounds: rounds.map((r) => ({ ...runView(r), bugs: Array.from(new Set(r.results.filter((x) => x.bugId).map((x) => x.bugId!))).map((id) => bugMap.get(id)).filter(Boolean) })),
  };
}

// ---------- 在用户电脑上执行（Claude Code 通过 MCP 领取 / 回传） ----------

type Who = SessionUser & { apiTokenScopes?: readonly string[] };
const hasScope = (u: Who, s: string) => !u.apiTokenScopes || u.apiTokenScopes.includes(s);

async function localRun(user: Who, runId: unknown, write: boolean) {
  if (!hasScope(user, "docs.read") || (write && !hasScope(user, "docs.edit"))) throw new TestError(write ? "令牌需要「读文档」和「编辑文档」权限" : "令牌需要「读文档」权限", 403);
  const run = await prisma.deliveryRun.findUnique({ where: { id: String(runId || "") }, include: { delivery: true, results: true } });
  const { canEditDocs, canViewSpace } = await import("../docs/docs-query");
  if (!run || run.executor !== "local" || !(await canViewSpace(user, run.delivery.projectId))) throw new TestError("这一轮不存在，或不是「在我的电脑执行」", 404);
  if (write && !(await canEditDocs(user, run.delivery.projectId))) throw new TestError("没有编辑这个空间文档的权限", 403);
  return run;
}

/** MCP：我能执行的本机测试（排队中 / 执行中） */
export async function listLocalRuns(user: Who) {
  if (!hasScope(user, "docs.read")) throw new TestError("令牌需要「读文档」权限", 403);
  const { canViewSpace } = await import("../docs/docs-query");
  const runs = await prisma.deliveryRun.findMany({ where: { executor: "local", status: { in: ["queued", "running"] } }, include: { delivery: { select: { projectId: true, sourcePageId: true } }, results: { select: { status: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const out = [];
  for (const r of runs) {
    if (!(await canViewSpace(user, r.delivery.projectId))) continue;
    const src = await prisma.docPage.findUnique({ where: { id: r.delivery.sourcePageId }, select: { title: true } });
    out.push({ runId: r.id, round: r.round, status: r.status, doc: src?.title ?? "", env: r.envUrl, total: r.results.length, reported: r.results.filter((x) => x.status !== "pending").length, mine: r.createdById === user.id, createdAt: r.createdAt });
  }
  return out;
}

/** MCP：读一轮的用例（第一次读时领取，状态变成执行中）；测试账号密码只给发起人 */
export async function getLocalRun(user: Who, runId: unknown) {
  const run = await localRun(user, runId, true);
  if (run.status === "queued") await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: "running", startedAt: new Date(), claimedAt: new Date() } });
  else if (run.status !== "running") throw new TestError("这一轮已经结束");
  const page = run.delivery.casesPageId ? await prisma.docPage.findUnique({ where: { id: run.delivery.casesPageId } }) : null;
  const cases = new Map(parseCasesBody(page?.body || "").map((c) => [c.code, c]));
  const { openText } = await import("../shared/secure-config");
  const mine = run.createdById === user.id;
  return {
    runId: run.id,
    round: run.round,
    env: { name: run.envName, url: run.envUrl },
    account: { username: run.delivery.testUser || "", password: mine ? openText(run.delivery.testPassEnc) || "" : "（只有发起人能拿到密码）" },
    scripts: await scriptsForAgent(run.delivery.scripts, run.delivery.projectId, run.envUrl || ""),
    login: await (async () => {
      const { parseLoginConfig } = await import("./login-config");
      const cfg = parseLoginConfig(run.delivery.loginConfig);
      if (!cfg) return null;
      return { path: cfg.path, userField: cfg.user, passField: cfg.pass, submit: cfg.submit, when: "前置条件里写了登录（不是「未登录」）的用例，先按这些步骤登录再执行", accounts: cfg.accounts.map((a) => ({ match: a.match, username: a.username, password: mine ? openText(a.passEnc) || "" : "（只有发起人能拿到密码）" })) };
    })(),
    howTo: "按 cases 逐条执行（如果 login 不为空：前置条件里写了登录、又不是「未登录」的用例，先打开 env.url + login.path 按 userField / passField / submit 登录，账号按 login.accounts 的关键词匹配前置条件选择，都不匹配用 account；如果 scripts 不为空，这是用户上传的自定义测试脚本，可以先在本机按脚本执行，再把结果按用例编号回传）：steps 是结构化步骤（goto 路径相对 env.url；{{username}} / {{password}} 换成 account）。每条执行完调用 delivery_report_test_result 回传 passed / failed / blocked / skipped，失败附上 message 和截图；全部回传后调用 delivery_finish_test_run。不要访问 env.url 以外的业务地址，不要把密码写进 message。",
    cases: run.results.map((r) => ({ ...(cases.get(r.code) ?? { code: r.code, title: r.title, priority: r.priority, mode: r.mode, steps: [], expected: "", precondition: "", feature: "" }), reported: r.status !== "pending" ? r.status : null })),
  };
}

const SHOT_MAX = 5 * 1024 * 1024;
function imageOf(b64: unknown): { data: Buffer; mime: string } | null {
  if (typeof b64 !== "string" || !b64) return null;
  const raw = b64.replace(/^data:image\/[a-z]+;base64,/i, "");
  const data = Buffer.from(raw, "base64");
  if (!data.length || data.length > SHOT_MAX) throw new TestError("截图不能超过 5 MB");
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { data, mime: "image/png" };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { data, mime: "image/jpeg" };
  throw new TestError("截图只支持 PNG / JPEG");
}

/** MCP：回传一条结果 { runId, code, status, message?, failedStep?, durationMs?, screenshotBase64? } */
export async function reportLocalResult(user: Who, body: Record<string, unknown>) {
  const run = await localRun(user, body.runId, true);
  if (run.status !== "running") throw new TestError(run.status === "queued" ? "先调用 delivery_get_test_run 领取这一轮" : "这一轮已经结束");
  const r = run.results.find((x) => x.code === String(body.code || "").toUpperCase());
  if (!r) throw new TestError("这一轮没有这条用例", 404);
  const status = String(body.status || "");
  if (!["passed", "failed", "blocked", "skipped"].includes(status)) throw new TestError("status 只能是 passed / failed / blocked / skipped");
  const pass = (await import("../shared/secure-config")).openText(run.delivery.testPassEnc) || "";
  let message = String(body.message || "").trim().slice(0, 500) || null;
  if (message && pass) message = message.split(pass).join("***");
  const img = imageOf(body.screenshotBase64);
  const att = img ? await prisma.attachment.create({ data: { ownerType: "delivery_run", ownerId: run.id, name: `${r.code}.${img.mime === "image/png" ? "png" : "jpg"}`, mime: img.mime, size: img.data.length, data: img.data, uploaderId: user.id } }) : null;
  const step = Number(body.failedStep);
  await prisma.deliveryResult.update({
    where: { id: r.id },
    data: { status, message: status === "passed" ? null : message, failedStep: Number.isInteger(step) && step > 0 ? step : null, durationMs: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.round(Number(body.durationMs))) : null, ...(att ? { screenshotId: att.id } : {}) },
  });
  const reported = await prisma.deliveryResult.count({ where: { runId: run.id, status: { not: "pending" } } });
  await prisma.deliveryRun.update({ where: { id: run.id }, data: { doneCount: reported, currentCode: r.code } });
  return { ok: true, reported, total: run.results.length };
}

/** MCP：本机执行结束；还没回传的手工用例留给人在面板里填 */
export async function finishLocalRun(user: Who, runId: unknown) {
  const run = await localRun(user, runId, true);
  if (run.status !== "running") throw new TestError("这一轮不在执行中");
  const pending = await prisma.deliveryResult.count({ where: { runId: run.id, status: "pending" } });
  await prisma.deliveryRun.update({ where: { id: run.id }, data: { status: pending ? "manual" : "done", finishedAt: new Date(), currentCode: null } });
  return { ok: true, pending, next: pending ? `还有 ${pending} 条没回传，需要在小围空间的需求交付面板里填结果，再点「完成本轮」` : "请到小围空间的需求交付面板点「完成本轮」，系统会提 Bug 并写测试记录" };
}
