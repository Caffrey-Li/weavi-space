import { findCodes } from "../shared/codes";

/**
 * T49 代码流转规则（纯函数）：提交信息乱也不会误流转。
 * - 提交只说明「有人在做」：只能把任务推到进行中；合并提交、Revert 提交不推。
 * - 「完成」只认合并进指定分支的 MR，且只算两种编号：源分支就是为它建的（feature/R1042-T1004），
 *   或 MR 标题 / 描述里用关闭词写了它（Closes T1004、完成 T1004）。只是提到的只挂关联。
 * - 草稿 MR（Draft: / WIP:）不推状态。
 */

const KEYWORDS = "close|closes|closed|closing|fix|fixes|fixed|resolve|resolves|resolved|implement|implements|implemented|done|完成|关闭|修复|解决|实现";
const CODE = "[RT]-?\\d{1,9}";
// 关闭词后面跟一串编号（空格、逗号、顿号、and、和 分隔）
const CLOSING = new RegExp(`(?<![A-Za-z])(?:${KEYWORDS})\\s*[:：]?\\s*((?:${CODE})(?:\\s*(?:,|，|、|and|和|&|\\s)\\s*(?:${CODE}))*)`, "gi");

/** MR 标题 / 描述里用关闭词写的编号 */
export function closingCodes(text: string) {
  const reqs = new Set<number>();
  const tasks = new Set<number>();
  for (const m of (text || "").matchAll(CLOSING)) {
    const c = findCodes(m[1]);
    c.reqs.forEach((n) => reqs.add(n));
    c.tasks.forEach((n) => tasks.add(n));
  }
  return { reqs: [...reqs], tasks: [...tasks] };
}

export const isMergeCommit = (message: string) => /^merge (branch|remote-tracking branch|pull request|tag|commit)\b|^merge .+ into .+/i.test((message || "").trim());
export const isRevertCommit = (message: string) => /^revert\b|this reverts commit [0-9a-f]{7,}/i.test((message || "").trim());
export const isDraftMr = (title: string, flag?: unknown) => flag === true || /^\s*(\[?draft\]?|\(draft\)|\[?wip\]?)\s*[:：\]]?\s/i.test(title || "");

/** 目标分支是否「算完成」：规则为空只认默认分支；支持逗号分隔和 * 通配 */
export function branchCounts(branch: string, patterns: string, defaultBranch: string) {
  const list = (patterns || "").split(/[,，\s]+/).map((p) => p.trim()).filter(Boolean);
  const rules = list.length ? list : [defaultBranch];
  return rules.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(branch));
}

/** 分支规则输入清洗：只允许分支名字符和 *，最多 10 条 */
export function cleanBranchPatterns(raw: unknown): string | null {
  const list = String(raw ?? "").split(/[,，\s]+/).map((p) => p.trim()).filter(Boolean);
  if (list.length > 10 || list.some((p) => !/^[A-Za-z0-9._/*-]{1,100}$/.test(p))) return null;
  return list.join(",");
}
