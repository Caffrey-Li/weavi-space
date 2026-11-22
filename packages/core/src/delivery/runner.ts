import type { Browser, BrowserContext, Page } from "playwright-core";
import { prisma } from "@pm-collab/db/prisma";
import { privateHost } from "../ai/providers";
import { needsLogin, parseLoginConfig, pickAccount, type LoginConfig } from "./login-config";
import { openText } from "../shared/secure-config";
import { parseCasesBody, type TestCase, type TestStep } from "../shared/testcases";

/**
 * 需求交付 · 测试执行器（T24 第二期）：服务器上的无头浏览器按「结构化步骤」执行，不运行任何代码。
 * - 只允许访问测试环境的地址（同 host）；其他公网地址只放行子资源，内网 / 本机地址一律拦下（测试环境本身登记的是内网地址时除外）
 * - 全系统同一时间只跑一轮（进程内串行），其余排队；一轮最长 30 分钟，单条用例最长 3 分钟
 * - 失败截图存 attachments（ownerType = delivery_run），提 Bug 时随描述挂到 Bug 上
 * 浏览器：PM_TEST_BROWSER 指定可执行文件；否则依次试本机 Chrome、Playwright 自带的 Chromium（npx playwright install chromium）。
 */

const RUN_LIMIT = 30 * 60 * 1000;
const CASE_LIMIT = 3 * 60 * 1000;
const STEP_TIMEOUT = 15_000;
let running: string | null = null;
const RESUMED = "服务重启后续跑";
const LOCAL_LIMIT = 12 * 60 * 60 * 1000;
let looping = false;

export class StepError extends Error {
  constructor(
    message: string,
    public step: number,
    public blocked = false,
  ) {
    super(message);
  }
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const exe = process.env.PM_TEST_BROWSER;
  const tries: Parameters<typeof chromium.launch>[0][] = exe ? [{ executablePath: exe }] : [{ channel: "chrome" }, {}];
  let last: unknown;
  for (const t of tries) {
    try {
      return await chromium.launch({ ...t, headless: true, args: ["--no-sandbox"] });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`没有可用的浏览器：服务器上执行 npx playwright install chromium，或设置 PM_TEST_BROWSER。${String((last as Error)?.message || "").split("\n")[0]}`);
}

/** 定位写法和导出 Playwright 一致：label= / placeholder= / role=x[name=y] / testid= / css= / text=（默认按文字） */
export function locate(page: Page, target: string) {
  const m = target.match(/^(text|label|placeholder|role|testid|css)=([\s\S]*)$/);
  const kind = m?.[1] ?? "text";
  const v = (m?.[2] ?? target).trim();
  if (kind === "label") return page.getByLabel(v).first();
  if (kind === "placeholder") return page.getByPlaceholder(v).first();
  if (kind === "testid") return page.getByTestId(v).first();
  if (kind === "css") return page.locator(v).first();
  if (kind === "role") {
    const r = v.match(/^([a-z]+)(?:\[name=(.*)\])?$/i);
    if (r) return page.getByRole(r[1] as Parameters<Page["getByRole"]>[0], r[2] ? { name: r[2].replace(/^["']|["']$/g, "") } : undefined).first();
  }
  return page.getByText(v).first();
}

const fillVars = (s: string, user: string, pass: string) => s.replace(/\{\{username\}\}/g, user).replace(/\{\{password\}\}/g, pass);
const firstLine = (e: unknown) => String((e as Error)?.message || e).split("\n")[0].replace(/\s+/g, " ").slice(0, 300);

/** 访问控制：测试环境同 host 放行；内网 / 本机拦下；其他公网地址只放行子资源（字体、CDN），不允许跳转过去 */
export function allowRequest(url: string, envHost: string, isNavigation: boolean) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.host === envHost) return true;
  if (privateHost(u.hostname)) return false;
  return !isNavigation;
}

async function runStep(page: Page, origin: string, s: TestStep, i: number, user: string, pass: string) {
  const val = fillVars(s.value, user, pass);
  try {
    switch (s.action) {
      case "goto": {
        const path = s.target.startsWith("/") ? s.target : `/${s.target}`;
        try {
          await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch (e) {
          throw new StepError(`打开 ${path} 失败：${firstLine(e)}`, i, true);
        }
        return;
      }
      case "click":
        return void (await locate(page, s.target).click());
      case "fill":
        return void (await locate(page, s.target).fill(val));
      case "select":
        return void (await locate(page, s.target).selectOption(val));
      case "press":
        return void (await page.keyboard.press(val || s.target));
      case "wait":
        return void (await page.waitForTimeout(Math.max(0, Math.min(300, Number(val || s.target) || 1)) * 1000));
      case "expectText": {
        const text = val || s.target;
        try {
          await page.getByText(text).first().waitFor({ state: "visible" });
        } catch {
          throw new StepError(`断言出现文字「${text}」：页面上没有找到`, i);
        }
        return;
      }
      case "expectUrl": {
        const part = val || s.target;
        try {
          await page.waitForURL((u) => u.href.includes(part));
        } catch {
          throw new StepError(`断言地址包含「${part}」：实际是 ${page.url()}`, i);
        }
        return;
      }
      case "expectVisible":
        try {
          await locate(page, s.target).waitFor({ state: "visible" });
        } catch {
          throw new StepError(`断言「${s.target}」可见：没有出现`, i);
        }
        return;
      default:
        return;
    }
  } catch (e) {
    if (e instanceof StepError) throw e;
    const msg = firstLine(e);
    throw new StepError(`${s.action} ${s.target}：${pass ? msg.split(pass).join("***") : msg}`, i);
  }
}

/** T55 自动登录：打开登录页、填账号密码、点登录，等地址离开登录页 */
async function autoLogin(page: Page, origin: string, cfg: LoginConfig, user: string, pass: string) {
  try {
    await page.goto(origin + cfg.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await locate(page, cfg.user).fill(user);
    await locate(page, cfg.pass).fill(pass);
    await locate(page, cfg.submit).click();
    await page.waitForURL((u) => !u.pathname.startsWith(cfg.path), { timeout: 15_000 });
  } catch (e) {
    const msg = firstLine(e);
    throw new StepError(`自动登录失败（账号 ${user}）：${pass ? msg.split(pass).join("***") : msg}`, 0, true);
  }
}

async function runCase(browser: Browser, run: { id: string; createdById: string }, envUrl: string, c: TestCase, user: string, pass: string, login: LoginConfig | null = null) {
  const origin = new URL(envUrl).origin;
  const envHost = new URL(envUrl).host;
  let ctx: BrowserContext | null = null;
  const started = Date.now();
  try {
    ctx = await browser.newContext({ acceptDownloads: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, locale: "zh-CN", serviceWorkers: "block" });
    await ctx.route("**/*", (route) => {
      const req = route.request();
      let topNav = false;
      try {
        topNav = req.isNavigationRequest() && !req.frame().parentFrame();
      } catch {
        topNav = false;
      }
      return allowRequest(req.url(), envHost, topNav) ? route.continue() : route.abort("blockedbyclient");
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    const mark = (n: number) => prisma.deliveryRun.update({ where: { id: run.id }, data: { currentStep: n } }).catch(() => undefined);
    const work = (async () => {
      if (login && needsLogin(c.precondition)) {
        await mark(0);
        await autoLogin(page, origin, login, user, pass);
      }
      for (let i = 0; i < c.steps.length; i++) {
        await mark(i + 1);
        await runStep(page, origin, c.steps[i], i + 1, user, pass);
      }
    })();
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new StepError("单条用例超过 3 分钟，已停止", 0)), CASE_LIMIT));
    try {
      await Promise.race([work, timer]);
      return { status: "passed", durationMs: Date.now() - started } as const;
    } catch (e) {
      const se = e instanceof StepError ? e : new StepError(firstLine(e), 0);
      let screenshotId: string | null = null;
      try {
        const png = await page.screenshot({ type: "png", timeout: 10_000 });
        const att = await prisma.attachment.create({ data: { ownerType: "delivery_run", ownerId: run.id, name: `${c.code}-第${se.step}步.png`, mime: "image/png", size: png.length, data: png, uploaderId: run.createdById } });
        screenshotId = att.id;
      } catch {
        /* 截不了图不影响结果 */
      }
      return { status: se.blocked ? "blocked" : "failed", failedStep: se.step || null, message: se.message, screenshotId, durationMs: Date.now() - started } as const;
    }
  } catch (e) {
    return { status: "blocked", message: `浏览器出错：${firstLine(e)}`, durationMs: Date.now() - started } as const;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

async function execute(runId: string) {
  const run = await prisma.deliveryRun.findUnique({ where: { id: runId }, include: { delivery: true, results: true } });
  if (!run) return;
  const d = run.delivery;
  const page = d.casesPageId ? await prisma.docPage.findUnique({ where: { id: d.casesPageId } }) : null;
  const cases = new Map(parseCasesBody(page?.body || "").map((c) => [c.code, c]));
  const user = d.testUser || "";
  const pass = openText(d.testPassEnc) || "";
  const login = parseLoginConfig(d.loginConfig);
  const started = Date.now();
  let browser: Browser | null = null;
  try {
    browser = await launch();
    // 只跑还没出结果的自动用例：服务重启后续跑时，已经跑完的不再重跑
    const auto = run.results.filter((r) => r.mode === "auto" && r.status === "pending");
    for (const r of auto) {
      const now = await prisma.deliveryRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (now?.status === "stopping") break;
      const c = cases.get(r.code);
      if (!c) {
        await prisma.deliveryResult.update({ where: { id: r.id }, data: { status: "skipped", message: "用例已被删除" } });
        continue;
      }
      if (Date.now() - started > RUN_LIMIT) {
        await prisma.deliveryResult.update({ where: { id: r.id }, data: { status: "skipped", message: "一轮超过 30 分钟，没有执行" } });
        continue;
      }
      await prisma.deliveryRun.update({ where: { id: runId }, data: { currentCode: r.code, currentStep: null } });
      // T55 按前置条件换账号（默认用测试账号）
      const acc = pickAccount(login, c.precondition, { username: user, password: pass });
      const out = await runCase(browser, run, run.envUrl, c, acc.username, acc.password, login);
      await prisma.deliveryResult.update({ where: { id: r.id }, data: { status: out.status, failedStep: "failedStep" in out ? out.failedStep : null, message: "message" in out ? out.message : null, screenshotId: "screenshotId" in out ? out.screenshotId : null, durationMs: out.durationMs } });
      await prisma.deliveryRun.update({ where: { id: runId }, data: { doneCount: { increment: 1 } } });
    }
    const after = await prisma.deliveryRun.findUnique({ where: { id: runId }, include: { results: true } });
    if (after?.status === "stopping") {
      await prisma.deliveryRun.update({ where: { id: runId }, data: { status: "stopped", finishedAt: new Date(), currentCode: null } });
      return;
    }
    const pending = after?.results.some((r) => r.status === "pending");
    await prisma.deliveryRun.update({ where: { id: runId }, data: { status: pending ? "manual" : "done", finishedAt: new Date(), currentCode: null, currentStep: null, error: null } });
  } catch (e) {
    await prisma.deliveryRun.update({ where: { id: runId }, data: { status: "failed", error: firstLine(e), finishedAt: new Date(), currentCode: null } });
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * 测试执行放在哪个进程（T27 二期）：默认在 web 进程里跑；设 TEST_RUNNER=worker 时 web 进程不跑，
 * 由独立进程 `npm run worker:test`（scripts/test-worker.ts）每几秒领取一次。浏览器占内存、一轮可能跑半小时，
 * 拆出去后 web 重启不打断测试，测试卡住也不拖慢页面。两边都用数据库里的状态比较后写入领取，不会重复执行。
 */
export function runnerInWeb() {
  return process.env.TEST_RUNNER !== "worker";
}

/** 处理排队：进程内串行，一次一轮。新建一轮、打开面板时调用；服务重启留下的「执行中」重新排队续跑 */
export async function kickRunner(opts?: { worker?: boolean }) {
  if (!opts?.worker && !runnerInWeb()) return;
  if (looping) return;
  looping = true;
  try {
    // 服务重启留下的「执行中」：重新排队，接着跑没出结果的用例（只续跑一次，再中断就标失败，避免反复崩溃）；「正在停止」的直接停掉
    const stale = await prisma.deliveryRun.findMany({ where: { executor: "server", status: { in: ["running", "stopping"] } }, select: { id: true, status: true, error: true } });
    for (const s of stale) {
      if (s.id === running) continue;
      if (s.status === "stopping") await prisma.deliveryRun.update({ where: { id: s.id }, data: { status: "stopped", finishedAt: new Date(), currentCode: null } });
      else if (s.error?.startsWith(RESUMED)) await prisma.deliveryRun.update({ where: { id: s.id }, data: { status: "failed", error: "服务连续重启，本轮中断，请重新发起", finishedAt: new Date(), currentCode: null } });
      else await prisma.deliveryRun.update({ where: { id: s.id }, data: { status: "queued", error: `${RESUMED}，已跑完的用例不重跑`, currentCode: null } });
    }
    // 在我的电脑执行的一轮：12 小时还没结束就自动停掉，免得一直占着「当前一轮」
    await prisma.deliveryRun.updateMany({ where: { executor: "local", status: { in: ["queued", "running"] }, createdAt: { lt: new Date(Date.now() - LOCAL_LIMIT) } }, data: { status: "failed", error: "在我的电脑执行超过 12 小时没有结束，已自动停止；已回传的结果保留", finishedAt: new Date(), currentCode: null } });
    for (;;) {
      const next = await prisma.deliveryRun.findFirst({ where: { executor: "server", status: "queued" }, orderBy: { createdAt: "asc" } });
      if (!next) break;
      const claimed = await prisma.deliveryRun.updateMany({ where: { id: next.id, executor: "server", status: "queued" }, data: { status: "running", startedAt: new Date() } });
      if (!claimed.count) continue;
      running = next.id;
      try {
        await execute(next.id);
      } finally {
        running = null;
      }
    }
  } catch (e) {
    console.error("[需求交付] 执行器出错", e);
  } finally {
    looping = false;
  }
}

export function queueBusy() {
  return running;
}
