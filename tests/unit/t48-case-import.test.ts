import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { detectFormat, normPriority, parseImport } from "@pm-collab/core/delivery/case-import";

describe("T48 用例导入格式", () => {
  it("优先级：P、禅道 1–4、高中低", () => {
    expect([normPriority("p1"), normPriority("1"), normPriority("4"), normPriority("高"), normPriority("低"), normPriority("critical"), normPriority("")]).toEqual(["P1", "P0", "P3", "P1", "P3", "P0", "P2"]);
  });
  it("按扩展名和内容识别格式", () => {
    expect(detectFormat("a.yml", "")).toBe("yaml");
    expect(detectFormat("x", "cases:\n  - id: TC-1")).toBe("yaml");
    expect(detectFormat("x", "| 标题 | 步骤 |\n|---|---|\n| a | b |")).toBe("md");
    expect(detectFormat("x", "<testcases>")).toBe("xml");
    expect(detectFormat("x", "标题,步骤")).toBe("csv");
  });
  it("YAML：caffrey-prd-plus 可执行用例（setup / steps / expect）", () => {
    const y = `cases:\n  - id: TC-001\n    feature: [F-03, F-04]\n    title: 选中时段后锁定\n    priority: P0\n    pre: [D1]\n    setup:\n      - login: \${USER_A}\n    steps:\n      - open: 页面「咨询师列表」\n      - input: { target: 输入框「称呼」, value: "测试01" }\n      - click: 按钮「预约」\n    expect:\n      - visible: 文本「锁定剩余」\n`;
    const r = parseImport({ text: y });
    expect(r.error).toBeUndefined();
    expect(r.cases[0]).toMatchObject({ code: "TC-001", feature: "F-03", priority: "P0", title: "选中时段后锁定" });
    expect(r.cases[0].steps.map((s) => s.action)).toEqual(["note", "goto", "fill", "click", "expectVisible"]);
    expect(r.cases[0].steps[2]).toEqual({ action: "fill", target: "输入框「称呼」", value: "测试01" });
    expect(parseImport({ text: "cases: [\n" }).error).toMatch(/YAML/);
    expect(parseImport({ text: "a: !!js/function 'function(){}'", format: "yaml" }).error).toBeTruthy();
  });
  it("Markdown 表格", () => {
    const r = parseImport({ text: "| 用例名称 | 优先级 | 步骤 | 预期结果 |\n| --- | --- | --- | --- |\n| 登录成功 | 高 | 打开 /login<br>点击 登录 | 进入工作台 |" });
    expect(r.cases[0]).toMatchObject({ title: "登录成功", priority: "P1", expected: "进入工作台" });
    expect(r.cases[0].steps).toHaveLength(2);
  });
  it("禅道 CSV（用例标题 / 步骤 / 预期 / 优先级 1–4）和 Excel 直接粘贴的制表符", () => {
    const zt = '用例标题,优先级,前置条件,步骤,预期\n"导出报表",2,已登录,"1. 打开 /report\n2. 点击 导出","1. 下载文件"';
    expect(parseImport({ text: zt }).cases[0]).toMatchObject({ title: "导出报表", priority: "P1", precondition: "已登录" });
    expect(parseImport({ text: "标题\t步骤\n粘贴的用例\t打开 /a" }).cases[0]).toMatchObject({ title: "粘贴的用例" });
  });
  it("TestLink XML", () => {
    const xml = `<testcases><testcase name="删除项目"><externalid>12</externalid><importance>3</importance><execution_type>1</execution_type><preconditions><![CDATA[<p>有一个空项目</p>]]></preconditions><steps><step><actions><![CDATA[<p>打开 /projects</p>]]></actions><expectedresults><![CDATA[<p>看到列表</p>]]></expectedresults></step><step><actions>点击 删除</actions><expectedresults>项目消失 &amp; 有提示</expectedresults></step></steps></testcase></testcases>`;
    const r = parseImport({ text: xml });
    expect(r.cases[0]).toMatchObject({ code: "TC-12", title: "删除项目", priority: "P0", mode: "manual", precondition: "有一个空项目", expected: "看到列表；项目消失 & 有提示" });
    expect(r.cases[0].steps.map((s) => s.action)).toEqual(["goto", "click"]);
  });
  it("Excel .xlsx（共享字符串 + 内联字符串）", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>优先级</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>1</v></c></row></sheetData></worksheet>`;
    const ss = `<sst><si><t>用例标题</t></si><si><t>步骤</t></si><si><t>新建项目</t></si><si><t>打开 /projects</t></si></sst>`;
    const bytes = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(ss) });
    const r = parseImport({ bytes, fileName: "cases.xlsx" });
    expect(r.format).toBe("xlsx");
    expect(r.cases[0]).toMatchObject({ title: "新建项目", priority: "P0" });
    expect(parseImport({ bytes: new Uint8Array([1, 2, 3]), fileName: "x.xlsx" }).error).toBeTruthy();
  });
  it("XMind（content.json：中心 › 模块 › 用例 › 步骤 › 预期）", () => {
    const t = (title: string, kids: unknown[] = [], markers?: unknown[]) => ({ title, children: { attached: kids }, ...(markers ? { markers } : {}) });
    const root = t("PM", [t("登录", [t("tc-密码登录", [t("打开 /login", [t("看到登录页")]), t("点击 登录", [t("进入工作台")])], [{ markerId: "priority-1" }])])]);
    const bytes = zipSync({ "content.json": strToU8(JSON.stringify([{ rootTopic: root }])) });
    const r = parseImport({ bytes, fileName: "cases.xmind" });
    expect(r.cases[0]).toMatchObject({ title: "登录 · 密码登录", priority: "P0", expected: "看到登录页；进入工作台" });
    expect(r.cases[0].steps).toHaveLength(2);
  });
});
