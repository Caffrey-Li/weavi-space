import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { chatOnce } from "../ai/providers";
import { credentialForUse } from "../ai/credentials";
import { recordUsage } from "../ai/quota";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { sanitizeDocHtml } from "../shared/doc-html";
import { refreshSkillPacks, skillFiles, skillVersions } from "./store";

/**
 * 个人能力：内置能力直接用系统打包的 caffrey-prd-plus、caffrey-test-runner 两个 skill 的完整说明和参考文件
 * （随代码发布的版本在 builtin/content.ts；服务端会从 GitHub 自动更新到最新版本，见 updater.ts / store.ts），按任务只带相关的参考文件；另外支持个人上传的 SKILL.md。
 * 用自己选的模型（个人或企业，企业模型计入定额）执行；结果可存到文档空间。MCP 里同样可调用，也能用 get_skill_file 读内置 skill 原文。
 */
const COMMON = "所有输出使用中文，先给结论再给细节，结构清晰，用 Markdown 小标题和列表；不确定的地方列成「待确认问题」，不要编造事实。";
const PRD = "caffrey-prd-plus";
const RUNNER = "caffrey-test-runner";
type Builtin = { key: string; name: string; description: string; skill: string; files: string[]; task: string };
export const BUILTIN_SKILLS: readonly Builtin[] = [
  { key: "req-analysis", name: "需求分析", description: "把一句话、纪要或截图梳理成结构化需求：类型判断、目标、用户、场景、范围、待确认问题（caffrey-prd-plus 新建流程第 1、2 步）", skill: PRD, files: ["SKILL.md", "references/question-bank.md", "references/types/_index.md", "references/industries/_index.md"], task: "只做「新建流程」的需求理解和澄清：判断需求类型和行业、梳理目标 / 用户 / 场景 / 范围 / 依赖与风险，列出待确认问题（按问题库分类，给出你的建议答案），不要写完整 PRD。" },
  { key: "prd", name: "PRD 生成", description: "按 caffrey-prd-plus 整理成开发、测试可直接执行的中文 PRD（模板、字段规范、章节矩阵、质量自检、线框图）", skill: PRD, files: ["SKILL.md", "references/prd-template.md", "references/field-spec.md", "references/section-matrix.md", "references/quality-checklist.md", "references/types/_index.md", "references/industries/_index.md", "references/wireframe.md", "references/diagrams.md"], task: "按「新建 PRD」模式直接写出完整 PRD：需求类型和章节按章节矩阵选，页面配文本线框图，流程用 Mermaid；没法当面确认的问题写进文末「待确认问题」，并按你的建议先写进正文。写完按质量自检清单自查，不合格的地方直接改好。" },
  { key: "user-stories", name: "拆用户故事", description: "按 caffrey-prd-plus 把 PRD 或需求拆成用户故事和验收标准", skill: PRD, files: ["SKILL.md", "references/user-stories.md"], task: "按「拆用户故事」模式输出用户故事和验收标准。" },
  { key: "prototype", name: "原型图生成", description: "按 caffrey-prd-plus 的原型规范生成一份可点击的单文件 HTML 原型（黑白灰线框风格）", skill: PRD, files: ["SKILL.md", "references/prototype.md", "references/wireframe.md"], task: "按「出原型图」模式生成一个单文件 HTML 原型：只用内联 CSS，不引用任何外部资源和脚本。只输出 HTML 代码本身（从 <!doctype html> 开始），不要解释。" },
  { key: "test-cases", name: "测试用例生成", description: "按 caffrey-prd-plus 的测试用例规范从 PRD 生成用例（覆盖正常、边界、异常、权限），步骤可被 caffrey-test-runner 执行", skill: PRD, files: ["SKILL.md", "references/test-cases.md"], task: "按「生成测试用例」模式输出测试用例：先给飞书表格格式的用例表，再给可执行的 YAML；最后列出覆盖不到或需要确认的点。" },
  { key: "prd-review", name: "检查 PRD", description: "按 caffrey-prd-plus 检查已有 PRD（包括别人写的、其他格式的）：完整性、确定性、一致性、可测试性，给出能否进入开发的结论", skill: PRD, files: ["SKILL.md", "references/prd-review.md", "references/quality-checklist.md", "references/types/_index.md", "references/industries/_index.md"], task: "按「检查 PRD」模式只出检查报告：先写能否进入开发的结论，再按完整性、确定性、一致性、可测试性列问题（位置、问题、建议改法），最后列需要用户确认的问题。不要直接输出修订版。" },
  { key: "test-plan", name: "测试方案生成", description: "按 caffrey-prd-plus 根据定稿或已有 PRD 生成网页 Agent 测试方案：范围、执行条件、执行顺序、安全与中断、结果与上线结论", skill: PRD, files: ["SKILL.md", "references/test-plan.md", "references/test-cases.md"], task: "按「生成测试用例」模式里的 Agent 测试方案输出一份测试方案（不需要同时输出全部用例）：依据与范围、执行条件、执行顺序与操作、安全与中断、结果与交付；PRD 里影响测试的缺口列在最前面并给出建议答案。" },
  { key: "test-report", name: "测试报告生成", description: "按 caffrey-test-runner 的结果表和缺陷单格式，根据执行结果写测试报告", skill: RUNNER, files: ["SKILL.md", "references/results.md"], task: "不执行测试，只根据用户给的执行结果和缺陷信息写测试报告：最前面按结果规范给出上线结论（建议上线 / 有条件上线 / 不建议上线 / 无法判定）和依据，再写执行统计（通过 / 失败 / 阻塞 / 需人工 / 跳过）、缺陷统计、遗留问题与风险。数字只用用户给的，不要编。" },
];

/** 内置 skill 的原文（给 MCP get_skill_file 和管理页查看） */
export function builtinSkillFile(skill: string, path = "SKILL.md") {
  const key = `${skill}/${path.replace(/^\/+/, "")}`;
  return skillFiles()[key] ?? null;
}
export function builtinSkillIndex() {
  const out: Record<string, { version: string; files: string[] }> = {};
  const versions = skillVersions();
  for (const k of Object.keys(skillFiles())) {
    const [skill, ...rest] = k.split("/");
    (out[skill] ??= { version: versions[skill] || "", files: [] }).files.push(rest.join("/"));
  }
  return out;
}
export { refreshSkillPacks };

function builtinPrompt(b: Builtin, task?: string) {
  const all = skillFiles();
  const files = b.files
    .map((f) => [f, all[`${b.skill}/${f}`]] as const)
    .filter(([, t]) => t)
    .map(([f, t]) => `===== 文件：${f} =====\n${t}`)
    .join("\n\n");
  return [
    `你按内置技能「${b.skill}」（v${skillVersions()[b.skill] || "?"}）完成任务。下面是它的说明（SKILL.md）和这次任务用到的参考文件。`,
    "你在小围空间里执行：只能文字作答，不能运行工具、读写文件或联网；跳过「版本检查」、读写本地文件、生成文件包等需要工具的步骤，把内容直接写在回复里；需要向用户确认的问题写进「待确认问题」，不要停下来等回复。",
    `本次任务：${task || b.task}`,
    COMMON,
    files,
  ].join("\n\n");
}

export async function listSkills(session: SessionUser) {
  await refreshSkillPacks();
  const versions = skillVersions();
  const mine = await prisma.userSkill.findMany({ where: { userId: session.id }, orderBy: { createdAt: "asc" } });
  return result({
    builtin: BUILTIN_SKILLS.map(({ key, name, description, skill }) => ({ id: `builtin:${key}`, name, description, builtin: true, source: `${skill} v${versions[skill] || ""}` })),
    mine: mine.map((s) => ({ id: s.id, name: s.name, description: s.description, builtin: false, size: s.content.length, updatedAt: s.updatedAt.toISOString() })),
  });
}

/** 上传 SKILL.md：从 frontmatter 读 name / description，没有就用传入的名称 */
export async function saveSkill(session: SessionUser, body: Record<string, unknown>) {
  const content = String(body.content || "").slice(0, 50_000);
  if (content.trim().length < 20) return result({ error: "SKILL.md 内容太短" }, { status: 400 });
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const pick = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");
  const name = String(body.name || pick("name") || "").trim().slice(0, 60);
  if (!name) return result({ error: "请填写名称，或在 SKILL.md 的 frontmatter 里写 name" }, { status: 400 });
  if ((await prisma.userSkill.count({ where: { userId: session.id } })) >= 30) return result({ error: "个人能力最多 30 个" }, { status: 400 });
  const s = await prisma.userSkill.create({ data: { userId: session.id, name, description: String(body.description || pick("description") || "").slice(0, 300), content } });
  return result({ id: s.id });
}

export async function deleteSkill(session: SessionUser, id: string) {
  const r = await prisma.userSkill.deleteMany({ where: { id, userId: session.id } });
  return r.count ? result({ ok: true }) : result({ error: "不存在" }, { status: 404 });
}

/** task：调用方（如需求交付）给的任务说明，替换内置能力默认的任务；输出格式由调用方在提示词后另行追加 */
export async function skillPrompt(session: SessionUser, id: string, task?: string) {
  if (id.startsWith("builtin:")) {
    await refreshSkillPacks();
    const b = BUILTIN_SKILLS.find((x) => `builtin:${x.key}` === id);
    return b ? { name: b.name, prompt: builtinPrompt(b, task), html: b.key === "prototype" } : null;
  }
  const s = await prisma.userSkill.findFirst({ where: { id, userId: session.id } });
  return s ? { name: s.name, prompt: `按下面这个 skill 的说明完成用户的任务（只在本系统里文字作答，无法执行其中提到的工具或命令）：\n\n${s.content}`, html: false } : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 执行：{ skillId, input, credentialId, model, spaceId? }；spaceId 给了就把结果存成该空间的一篇文档 */
export async function runSkill(session: SessionUser, body: Record<string, unknown>) {
  const sk = await skillPrompt(session, String(body.skillId || ""));
  if (!sk) return result({ error: "能力不存在" }, { status: 404 });
  const input = String(body.input || "").trim().slice(0, 20_000);
  if (!input) return result({ error: "请输入内容" }, { status: 400 });
  const spaceId = body.spaceId ? String(body.spaceId) : null;
  if (spaceId && (!(await canViewSpace(session, spaceId)) || !(await canEditDocs(session, spaceId)))) return result({ error: "没有在这个空间写文档的权限" }, { status: 403 });
  const use = await credentialForUse(session, String(body.credentialId || ""), String(body.model || ""));
  if ("error" in use) return result({ error: use.error }, { status: 402 });
  let out;
  try {
    out = await chatOnce(use.cred, String(body.model), sk.prompt, [{ role: "user", content: input }], 8000);
  } catch (e) {
    return result({ error: `模型调用失败：${(e as Error).message}` }, { status: 502 });
  }
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model: String(body.model), feature: "skill", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  let pageId: string | null = null;
  if (spaceId) {
    // 原型图存成代码块（文档里不执行 HTML）；其他按段落存
    const html = sanitizeDocHtml(sk.html ? `<pre><code>${esc(out.text)}</code></pre>` : out.text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n"));
    const title = `${sk.name} · ${new Date().toLocaleDateString("zh-CN")}`;
    const p = await prisma.docPage.create({ data: { projectId: spaceId, title, body: html, version: 1, publishedAt: new Date(), creatorId: session.id, updatedById: session.id } });
    await prisma.docPageVersion.create({ data: { pageId: p.id, version: 1, title, body: html, authorId: session.id } });
    pageId = p.id;
  }
  return result({ text: out.text, html: sk.html, pageId, spaceId, usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens } });
}

/** 能力详情（个人能力页「查看说明」）：内置的给来源、版本、用到的文件和 SKILL.md 原文；我的给上传的原文 */
export async function skillDetail(session: SessionUser, id: string) {
  if (id.startsWith("builtin:")) {
    const b = BUILTIN_SKILLS.find((x) => `builtin:${x.key}` === id);
    if (!b) return result({ error: "能力不存在" }, { status: 404 });
    await refreshSkillPacks();
    const all = skillFiles();
    const files = b.files.map((f) => ({ path: f, chars: (all[`${b.skill}/${f}`] || "").length }));
    return result({ id, name: b.name, description: b.description, builtin: true, source: b.skill, version: skillVersions()[b.skill] || "", task: b.task || "", files, content: (all[`${b.skill}/SKILL.md`] || "").slice(0, 40_000) });
  }
  const s = await prisma.userSkill.findFirst({ where: { id, userId: session.id } });
  if (!s) return result({ error: "能力不存在" }, { status: 404 });
  return result({ id: s.id, name: s.name, description: s.description, builtin: false, content: s.content });
}
