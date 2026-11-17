import { prisma } from "@pm-collab/db/prisma";
import { skillFiles } from "./store";
import { WIKI_SKILL_NAME } from "./builtin/wiki-content";

/**
 * Wiki 输出规范（内置 skill wiki-output-style）：AI 往文档空间（Wiki）写文档时自动追加到提示词里，
 * 让正文按「结论优先、黑白灰层级、按信息关系选组件」排版。用在：需求交付生成 PRD 和改 PRD 的建议、
 * 个人能力 / MCP run_skill 把结果存进文档空间。skill 不在（公开代码里是空壳）时返回空串，不影响原有行为。
 */

/** 本系统文档空间能渲染什么（skill 要求按目标 Wiki 的实际能力选组件） */
export const WIKI_TARGET = [
  "目标 Wiki：小围空间的文档空间。正文用 Markdown 输出，系统会转换成文档。已确认能渲染：",
  "- 二级、三级标题（四级及以下会降成三级）、段落、粗体、有序和无序列表、Markdown 管道表格、带语言的代码块、引用块、链接。",
  "- 提示块：以粗体短标题开头的引用块（例如 `> **关键规则**` 换行再写内容）会显示成中性提示块，用来放结论、关键限制或决策，一页一般只用一两个。",
  "- 关系图：```mermaid 代码块会渲染成图（flowchart、sequenceDiagram、stateDiagram-v2、erDiagram、classDiagram）。架构、依赖、分支、状态和时序优先用 Mermaid，节点文字用业务原词并加引号，边上写条件；同一组关系只用一种格式，不再重复给关系表。",
  "- 公式：单独成段的 $$ … $$ 会显示成公式块，紧跟一句说明变量和单位。不要用行内 $ 公式。",
  "- 不支持：图片、页签、折叠、表单等交互组件，按 skill 里的兼容写法处理（小标题分组、附录、字段表）。",
  "- 文档标题由系统单独承载，正文不要再写一级标题，从摘要或二级标题开始。",
].join("\n");

export function wikiStyleAvailable() {
  return Boolean(skillFiles()[`${WIKI_SKILL_NAME}/SKILL.md`]);
}

/** 追加到系统提示词末尾的排版规范；skill 不在时返回空串 */
export function wikiStylePrompt() {
  const all = skillFiles();
  const skill = all[`${WIKI_SKILL_NAME}/SKILL.md`];
  if (!skill) return "";
  const pick = (f: string) => all[`${WIKI_SKILL_NAME}/${f}`];
  const refs = ["references/components.md", "assets/wiki-example.md"]
    .filter((f) => pick(f))
    .map((f) => `===== 文件：${f} =====\n${pick(f)}`)
    .join("\n\n");
  return [
    "",
    "",
    "排版要求（系统追加：输出会直接写进 Wiki，按内置技能 wiki-output-style 的规范排版；内容、章节和编号以前面的要求为准，这里只管呈现）：",
    WIKI_TARGET,
    "跳过 skill 里读取页面、写入、回读和交付报告等需要工具的步骤，只输出排好版的正文。",
    `===== 文件：SKILL.md =====\n${skill}`,
    refs,
  ].join("\n");
}

/** 按个人开关（个人能力页「写进文档空间时按 Wiki 规范排版」，默认开）决定是否追加排版规范 */
export async function wikiStyleFor(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { wikiStyle: true } });
  return u && !u.wikiStyle ? "" : wikiStylePrompt();
}

export async function getWikiStyleSetting(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { wikiStyle: true } });
  return { on: u?.wikiStyle !== false, available: wikiStyleAvailable() };
}

export async function setWikiStyleSetting(userId: string, on: boolean) {
  await prisma.user.update({ where: { id: userId }, data: { wikiStyle: on } });
  return { on };
}
