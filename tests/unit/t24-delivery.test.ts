import { describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/core/skills/enterprise", () => ({ enterpriseOfUser: vi.fn(async () => ""), enterpriseSkills: vi.fn(async () => []), enterpriseOverride: vi.fn(async () => null) }));
import { applyBlockOp, blocksForAi, featureCodes, featureItems, mdToHtml, openQuestions, splitBlocks, stripFence } from "../../packages/core/src/delivery/blocks";
import { casesJson, coverage, dedupeCodes, locatorCode, parseCasesBody, sanitizeCases, stepText, toPlaywright } from "../../packages/core/src/shared/testcases";

const PRD = `## 1 背景\n\n登录太慢。\n\n## 2 功能清单\n\n- F-01 扫码登录\n- F-02 已绑定直接登录\n- F-03 未绑定提示\n\n## 3 规则\n\n3.2 二维码有效期 5 分钟。\n\n## 待确认问题\n\n1. Safari 要不要支持\n2. 导出带不带绑定状态\n`;

describe("T24 PRD 块", () => {
  it("Markdown 转成清洗过的 HTML，h4 降成 h3，去掉外层代码块", () => {
    const html = mdToHtml(stripFence("```markdown\n#### 小节\n\n<script>alert(1)</script>正文\n```"));
    expect(html).toContain("<h3>小节</h3>");
    expect(html).not.toContain("script");
  });
  it("按顶层块拆分、给模型编号", () => {
    const blocks = splitBlocks(mdToHtml(PRD));
    expect(blocks.length).toBe(8);
    const ai = blocksForAi(blocks);
    expect(ai).toContain("[B1] ## 1 背景");
    expect(ai).toContain("- F-01 扫码登录");
  });
  it("读出待确认问题和功能点", () => {
    const html = mdToHtml(PRD);
    expect(openQuestions(html)).toEqual(["Safari 要不要支持", "导出带不带绑定状态"]);
    expect(openQuestions(mdToHtml("## 待确认问题\n\n无\n"))).toEqual([]);
    expect(featureCodes(html)).toEqual(["F-01", "F-02", "F-03"]);
  });
  it("按原块内容替换 / 插入 / 删除；原块变了就拒绝", () => {
    const html = mdToHtml(PRD);
    const blocks = splitBlocks(html);
    const rule = blocks[5];
    const next = applyBlockOp(html, { op: "replace", targetHtml: rule, html: mdToHtml("3.2 二维码有效期 2 分钟。") });
    expect(next).toContain("2 分钟");
    expect(next).not.toContain("5 分钟");
    const ins = applyBlockOp(next!, { op: "insert_after", targetHtml: blocks[0], html: mdToHtml("目标：10 秒内登录。") });
    expect(splitBlocks(ins!)[1]).toContain("10 秒");
    const del = applyBlockOp(ins!, { op: "delete", targetHtml: blocks[7], html: "" });
    expect(openQuestions(del!)).toEqual([]);
    expect(applyBlockOp(next!, { op: "replace", targetHtml: rule, html: "<p>x</p>" })).toBeNull();
  });
});

describe("T24 测试用例", () => {
  const raw = {
    cases: [
      { code: "TC-01", title: "扫码登录成功", feature: "f-1", priority: "p0", mode: "auto", steps: [{ action: "goto", target: "/login" }, { action: "fill", target: "label=用户名", value: "{{username}}" }, { action: "click", target: "role=button[name=登录]" }, { action: "expectText", value: "工作台" }, { action: "rm -rf", target: "/" }] },
      { code: "TC-01", title: "重复编号", steps: [] },
      { title: "" },
    ],
  };
  it("清洗：动作白名单、编号去重、空标题丢掉、没有自动步骤算手工", () => {
    const c = sanitizeCases(raw)!.cases;
    expect(c).toHaveLength(2);
    expect(c[0].steps).toHaveLength(4);
    expect(c[0].priority).toBe("P0");
    expect(c[0].feature).toBe("F-01");
    expect(c[1].code).toBe("TC-02");
    expect(c[1].mode).toBe("manual");
    expect(sanitizeCases("not json")).toBeNull();
    expect(parseCasesBody(casesJson(c))).toEqual(c);
    expect(dedupeCodes([c[0], { ...c[1], code: "TC-01" }]).map((x) => x.code)).toEqual(["TC-01", "TC-02"]);
  });
  it("覆盖情况", () => {
    const c = sanitizeCases({ cases: [{ title: "a", feature: "F-01", steps: [{ action: "goto", target: "/" }] }] })!.cases;
    expect(coverage(["F-01", "F-02"], c)).toEqual({ total: 2, covered: 1, missing: ["F-02"] });
  });
  it("导出 Playwright：定位写法、账号占位、字符串转义", () => {
    expect(locatorCode("label=用户名")).toBe('page.getByLabel("用户名")');
    expect(locatorCode("role=button[name=登录]")).toBe('page.getByRole("button", { name: "登录" })');
    expect(locatorCode('css=a"b')).toBe('page.locator("a\\"b")');
    const c = sanitizeCases(raw)!.cases;
    const code = toPlaywright(c, "扫码");
    expect(code).toContain('await page.goto(BASE + "/login");');
    expect(code).toContain("fill(USERNAME)");
    expect(code).toContain('test.skip("TC-02 重复编号"');
    expect(stepText(c[0].steps[1])).toBe("输入  label=用户名  「{{username}}」");
  });
});

describe("T24 解析模型返回", () => {
  it("[{…}] 按数组解析；```json 包裹也能读", async () => {
    const { parseJsonLoose } = await import("../../packages/core/src/delivery/service");
    expect(parseJsonLoose('[{"op":"add"}]')).toEqual([{ op: "add" }]);
    expect(parseJsonLoose('```json\n{"cases":[]}\n```')).toEqual({ cases: [] });
    expect(parseJsonLoose("说明文字 [{\"a\":1},{\"b\":2}] 结束")).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("T24 第二期：执行器访问控制、测试记录", () => {
  it("只放行测试环境同 host；内网 / 本机一律拦；其他公网只放行子资源", async () => {
    const { allowRequest } = await import("../../packages/core/src/delivery/runner");
    expect(allowRequest("https://test.example.com/login", "test.example.com", true)).toBe(true);
    expect(allowRequest("http://127.0.0.1:5432/", "test.example.com", false)).toBe(false);
    expect(allowRequest("http://192.168.1.2/admin", "test.example.com", false)).toBe(false);
    expect(allowRequest("https://cdn.example.net/a.js", "test.example.com", false)).toBe(true);
    expect(allowRequest("https://evil.example.net/", "test.example.com", true)).toBe(false);
    expect(allowRequest("file:///etc/passwd", "test.example.com", true)).toBe(false);
    expect(allowRequest("http://10.0.0.5:8080/x", "10.0.0.5:8080", true)).toBe(true);
  });
  it("测试记录整节替换，不重复追加；统计把误报算通过", async () => {
    const { withReport, counts } = await import("../../packages/core/src/delivery/testing");
    const prd = "<h2>1 背景</h2><p>x</p>";
    const once = withReport(prd, "<h2>测试记录（系统生成）</h2><p>第 1 轮</p>");
    const twice = withReport(once, "<h2>测试记录（系统生成）</h2><p>第 2 轮</p>");
    expect(twice).toContain("第 2 轮");
    expect(twice).not.toContain("第 1 轮");
    expect(twice.match(/测试记录/g)).toHaveLength(1);
    expect(twice.startsWith("<h2>1 背景</h2>")).toBe(true);
    const c = counts([{ status: "passed", voided: false }, { status: "failed", voided: false }, { status: "failed", voided: true }, { status: "blocked", voided: false }]);
    expect(c).toMatchObject({ total: 4, passed: 2, failed: 1, blocked: 1, voided: 1, rate: 50 });
  });
});

describe("T24 第三期：功能点拆需求", () => {
  it("从功能清单读出编号和名称，编号统一、重复的只取第一次", () => {
    const html = mdToHtml("## 2 功能清单\n\n- F-01 登录页扫码\n- F-2：已绑定直接登录\n- F-01 重复\n- 不是功能点\n");
    expect(featureItems(html)).toEqual([
      { code: "F-01", title: "登录页扫码" },
      { code: "F-02", title: "已绑定直接登录" },
    ]);
  });
});

describe("内置 skill：用系统打包的 caffrey-prd-plus / caffrey-test-runner 原文", () => {
  it("每项内置能力的参考文件都存在；提示词带上 SKILL.md 和任务", async () => {
    const { BUILTIN_SKILLS, builtinSkillFile, builtinSkillIndex, skillPrompt } = await import("../../packages/core/src/skills/service");
    for (const b of BUILTIN_SKILLS) for (const f of b.files) expect(builtinSkillFile(b.skill, f), `${b.skill}/${f}`).not.toBeNull();
    expect(builtinSkillIndex()["caffrey-test-runner"].files).toContain("references/weavi-delivery.md");
    const p = await skillPrompt({ id: "u" } as never, "builtin:prd", "自定义任务");
    expect(p?.prompt).toContain("caffrey-prd-plus");
    expect(p?.prompt).toContain("本次任务：自定义任务");
    expect(p?.prompt).toContain("===== 文件：references/prd-template.md =====");
    expect(p!.prompt.length).toBeLessThan(80_000);
  });
});

describe("改进：附件取文字、用例版本记录", () => {
  // 拼一个只含 word/document.xml 的最小 zip（deflate）
  function makeDocx(xml: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require("node:zlib") as typeof import("node:zlib");
    const name = Buffer.from("word/document.xml");
    const raw = Buffer.from(xml, "utf8");
    const comp = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = 30 + name.length + comp.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, name, comp, central, name, end]).toString("base64");
  }
  it("docx / txt 取文字；pdf 提示另存", async () => {
    const { extractText, attachmentsText } = await import("../../packages/core/src/delivery/extract");
    const xml = '<w:document><w:body><w:p><w:r><w:t>会议结论</w:t></w:r></w:p><w:p><w:r><w:t>扫码 &amp; 登录</w:t></w:r></w:p></w:body></w:document>';
    expect(extractText("纪要.docx", makeDocx(xml))).toBe("会议结论\n扫码 & 登录");
    expect(extractText("a.md", Buffer.from("# 标题").toString("base64"))).toBe("# 标题");
    expect(() => extractText("a.pdf", Buffer.from("%PDF").toString("base64"))).toThrow(/另存为/);
    expect(() => attachmentsText([1, 2, 3, 4].map(() => ({ name: "a.txt", data: "YQ==" })))).toThrow(/最多/);
    expect(attachmentsText([{ name: "a.txt", data: Buffer.from("内容").toString("base64") }]).text).toContain("【附件：a.txt】");
  });
  it("用例版本记录转成一条用例一段", async () => {
    const { casesToHtml, casesJson, sanitizeCases } = await import("../../packages/core/src/shared/testcases");
    const html = casesToHtml(casesJson(sanitizeCases({ cases: [{ title: "登录<b>", feature: "F-01", steps: [{ action: "goto", target: "/login" }] }] })!.cases));
    expect(html).toContain("TC-01 登录&lt;b&gt;");
    expect(html).toContain("1. 打开  /login");
    expect(casesToHtml("{}")).toContain("没有用例");
  });
});
