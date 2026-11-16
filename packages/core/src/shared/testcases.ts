/**
 * 需求交付 · 测试用例页（DocPage.kind = "testcases"）：正文存 { cases: TestCase[] } 的 JSON。
 * 纯函数，前后端共用：清洗校验、对比、导出 Playwright、覆盖情况。
 *
 * 脚本是「结构化步骤」（打开 / 点击 / 输入 / 断言…），不是代码：二期由系统翻译成浏览器操作执行，导出时才转成 Playwright 代码。
 */

export const STEP_ACTIONS = ["goto", "click", "fill", "select", "press", "wait", "expectText", "expectUrl", "expectVisible", "note"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export const STEP_LABEL: Record<StepAction, string> = {
  goto: "打开",
  click: "点击",
  fill: "输入",
  select: "选择",
  press: "按键",
  wait: "等待",
  expectText: "断言出现文字",
  expectUrl: "断言地址包含",
  expectVisible: "断言可见",
  note: "人工",
};
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type TestStep = { action: StepAction; target: string; value: string };
export type TestCase = {
  code: string;
  title: string;
  feature: string;
  priority: Priority;
  mode: "auto" | "manual";
  precondition: string;
  steps: TestStep[];
  expected: string;
};
export type CasesDoc = { cases: TestCase[] };

export const MAX_CASES = 300;
const MAX_STEPS = 40;
const str = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function cleanStep(raw: unknown): TestStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const action = String(r.action || "") as StepAction;
  if (!STEP_ACTIONS.includes(action)) return null;
  const target = str(r.target, 300);
  const value = str(r.value, 500);
  if (!target && !value) return null;
  return { action, target, value };
}

/** 功能点编号统一成 F-01 这种写法 */
export function featureCode(v: string) {
  const m = v.match(/^F-?(\d{1,4})$/i);
  return m ? `F-${m[1].padStart(2, "0")}` : "";
}

export function cleanCase(raw: unknown, i = 0): TestCase | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 200);
  if (!title) return null;
  const pri = str(r.priority, 4).toUpperCase() as Priority;
  const steps = (Array.isArray(r.steps) ? r.steps : []).map(cleanStep).filter((s): s is TestStep => s !== null).slice(0, MAX_STEPS);
  const manual = r.mode === "manual" || !steps.some((s) => s.action !== "note");
  return {
    code: /^TC-\d{1,4}$/.test(str(r.code, 10).toUpperCase()) ? str(r.code, 10).toUpperCase() : `TC-${String(i + 1).padStart(2, "0")}`,
    title,
    feature: featureCode(str(r.feature, 10)),
    priority: PRIORITIES.includes(pri) ? pri : "P2",
    mode: manual ? "manual" : "auto",
    precondition: str(r.precondition, 500),
    steps,
    expected: str(r.expected, 1000),
  };
}

/** 清洗整份用例：编号重复的往后顺延。返回 null 表示格式不对 */
export function sanitizeCases(input: unknown): CasesDoc | null {
  let v = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v || "{}");
    } catch {
      return null;
    }
  }
  const list = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as CasesDoc).cases) ? (v as CasesDoc).cases : null;
  if (!list) return null;
  const cases = list.map((c, i) => cleanCase(c, i)).filter((c): c is TestCase => c !== null).slice(0, MAX_CASES);
  return { cases: dedupeCodes(cases) };
}

export function dedupeCodes(cases: TestCase[]): TestCase[] {
  const used = new Set<string>();
  let next = 1 + Math.max(0, ...cases.map((c) => Number(c.code.slice(3)) || 0));
  return cases.map((c) => {
    if (!used.has(c.code)) {
      used.add(c.code);
      return c;
    }
    const code = `TC-${String(next++).padStart(2, "0")}`;
    used.add(code);
    return { ...c, code };
  });
}

export function parseCasesBody(body: string): TestCase[] {
  return sanitizeCases(body)?.cases ?? [];
}

export function casesJson(cases: TestCase[]) {
  return JSON.stringify({ cases });
}

export function stepText(s: TestStep) {
  const parts = [STEP_LABEL[s.action]];
  if (s.action === "wait") parts.push(`${s.value || s.target} 秒`);
  else {
    if (s.target) parts.push(s.target);
    if (s.value) parts.push(s.action === "fill" || s.action === "select" ? `「${s.value}」` : s.value);
  }
  return parts.join("  ");
}

/** 给模型看的用例清单（紧凑 JSON） */
export function casesForAi(cases: TestCase[]) {
  return JSON.stringify(cases).slice(0, 40_000);
}

/** PRD 功能点 vs 用例：哪些功能点还没有用例 */
export function coverage(features: string[], cases: TestCase[]) {
  const covered = new Set(cases.map((c) => c.feature).filter(Boolean));
  return { total: features.length, covered: features.filter((f) => covered.has(f)).length, missing: features.filter((f) => !covered.has(f)) };
}

export function casesSummary(cases: TestCase[]) {
  const auto = cases.filter((c) => c.mode === "auto").length;
  return { total: cases.length, auto, manual: cases.length - auto };
}

// ---------- 导出 Playwright ----------

const q = (s: string) => JSON.stringify(s);
function fillVars(s: string) {
  if (!/\{\{(username|password)\}\}/.test(s)) return q(s);
  const parts = s.split(/(\{\{username\}\}|\{\{password\}\})/).filter(Boolean);
  return parts.map((p) => (p === "{{username}}" ? "USERNAME" : p === "{{password}}" ? "PASSWORD" : q(p))).join(" + ");
}

/** 定位写法：text=文字 / label=标签 / placeholder=提示 / role=button[name=登录] / testid=… / css=选择器；其他按文字找 */
export function locatorCode(target: string) {
  const m = target.match(/^(text|label|placeholder|role|testid|css)=([\s\S]*)$/);
  const kind = m?.[1] ?? "text";
  const v = (m?.[2] ?? target).trim();
  if (kind === "label") return `page.getByLabel(${q(v)})`;
  if (kind === "placeholder") return `page.getByPlaceholder(${q(v)})`;
  if (kind === "testid") return `page.getByTestId(${q(v)})`;
  if (kind === "css") return `page.locator(${q(v)})`;
  if (kind === "role") {
    const r = v.match(/^([a-z]+)(?:\[name=(.*)\])?$/i);
    if (r) return r[2] ? `page.getByRole(${q(r[1])}, { name: ${q(r[2].replace(/^["']|["']$/g, ""))} })` : `page.getByRole(${q(r[1])})`;
  }
  return `page.getByText(${q(v)}).first()`;
}

function stepCode(s: TestStep) {
  const loc = () => locatorCode(s.target);
  switch (s.action) {
    case "goto":
      return `await page.goto(BASE + ${q(s.target.startsWith("/") ? s.target : `/${s.target}`)});`;
    case "click":
      return `await ${loc()}.click();`;
    case "fill":
      return `await ${loc()}.fill(${fillVars(s.value)});`;
    case "select":
      return `await ${loc()}.selectOption(${q(s.value)});`;
    case "press":
      return `await page.keyboard.press(${q(s.value || s.target)});`;
    case "wait":
      return `await page.waitForTimeout(${Math.max(0, Math.min(600, Number(s.value || s.target) || 1)) * 1000});`;
    case "expectText":
      return `await expect(page.getByText(${q(s.value || s.target)}).first()).toBeVisible();`;
    case "expectUrl":
      return `await expect(page).toHaveURL(new RegExp(${q((s.value || s.target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}));`;
    case "expectVisible":
      return `await expect(${loc()}).toBeVisible();`;
    default:
      return `// 人工：${(s.value || s.target).replace(/\n/g, " ")}`;
  }
}

export function toPlaywright(cases: TestCase[], title: string, baseUrl = "") {
  const lines = [
    `// ${title}`,
    "// 由 Weavi Space「需求交付」导出。运行：BASE_URL=… TEST_USERNAME=… TEST_PASSWORD=… npx playwright test",
    'import { test, expect } from "@playwright/test";',
    "",
    `const BASE = process.env.BASE_URL ?? ${q(baseUrl || "http://localhost:3000")};`,
    'const USERNAME = process.env.TEST_USERNAME ?? "";',
    'const PASSWORD = process.env.TEST_PASSWORD ?? "";',
    "void USERNAME;",
    "void PASSWORD;",
    "",
    `test.describe(${q(title)}, () => {`,
  ];
  for (const c of cases) {
    const name = q(`${c.code} ${c.title}`);
    if (c.mode === "manual") {
      lines.push(`  // 手工用例：${c.steps.map(stepText).join("；") || c.expected}`);
      lines.push(`  test.skip(${name}, async () => {});`);
      continue;
    }
    lines.push(`  test(${name}, async ({ page }) => {`);
    if (c.precondition) lines.push(`    // 前置条件：${c.precondition}`);
    for (const s of c.steps) lines.push(`    ${stepCode(s)}`);
    if (c.expected) lines.push(`    // 预期：${c.expected}`);
    lines.push("  });");
  }
  lines.push("});", "");
  return lines.join("\n");
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 用例页的版本记录：把 JSON 正文转成一条用例一段的 HTML，查看和逐段对比都按用例来 */
export function casesToHtml(body: string) {
  const cases = parseCasesBody(body);
  if (!cases.length) return "<p>（没有用例）</p>";
  return cases
    .map((c) => {
      const steps = c.steps.map((s, i) => `${i + 1}. ${stepText(s)}`).join("；");
      return `<p><strong>${escHtml(c.code)} ${escHtml(c.title)}</strong> · ${escHtml(c.feature || "—")} · ${c.priority} · ${c.mode === "auto" ? "自动" : "手工"}${c.precondition ? ` · 前置：${escHtml(c.precondition)}` : ""}<br>${escHtml(steps || "（无步骤）")}${c.expected ? `<br>预期：${escHtml(c.expected)}` : ""}</p>`;
    })
    .join("\n");
}
