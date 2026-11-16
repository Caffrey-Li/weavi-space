import { docPlainText } from "./doc-html";

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** 按段落（纯文本行）对比两个版本的正文，用于历史版本「与上一版对比」。行数过多时只比前 MAX 行 */
const MAX = 1500;

function lines(html: string) {
  return docPlainText(html)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX);
}

export function diffDocBodies(prevHtml: string, nextHtml: string): { lines: DiffLine[]; added: number; removed: number } {
  const a = lines(prevHtml);
  const b = lines(nextHtml);
  const n = a.length;
  const m = b.length;
  // LCS 表（从尾部算起），回溯得到逐行差异
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i++] });
      removed++;
    } else {
      out.push({ kind: "add", text: b[j++] });
      added++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: a[i++] });
    removed++;
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j++] });
    added++;
  }
  return { lines: out, added, removed };
}
