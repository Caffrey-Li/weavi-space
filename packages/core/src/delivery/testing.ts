import type { Delivery, DeliveryResult, DeliveryRun } from "@prisma/client";
import { advanceRequirements, deliveryRequirements } from "../requirements/flow";
import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
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
  await prisma.delivery.update({ where: { id: d.id }, data });
}

async function activeRound(deliveryId: string) {
  return prisma.deliveryRun.findFirst({ where: { deliveryId, kind: "round", status: { in: ACTIVE } }, orderBy: { createdAt: "desc" } });
}

/** 发起：{ kind: "round" | "trial", scope?: "all" | "failed", code?（试跑） } */
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
  if (run.status === "manual") throw new TestError("还有手工用例没填结果");
  if (run.status !== "done") throw new TestError("这一轮还没跑完");
  const claimed = await prisma.deliveryRun.updateMany({ where: { id: run.id, status: "done" }, data: { status: "finalizing" } });
  if (!claimed.count) throw new TestError("正在处理，请稍候", 409);
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
    error: run.error,
    createdAt: run.createdAt,
    finalizedAt: run.finalizedAt,
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
    howTo: "按 cases 逐条执行：steps 是结构化步骤（goto 路径相对 env.url；{{username}} / {{password}} 换成 account）。每条执行完调用 delivery_report_test_result 回传 passed / failed / blocked / skipped，失败附上 message 和截图；全部回传后调用 delivery_finish_test_run。不要访问 env.url 以外的业务地址，不要把密码写进 message。",
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
