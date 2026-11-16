/**
 * 根据描述生成标题（规则版，前后端共用）：取描述里第一句有内容的话，去掉客套前缀和列表符号，
 * 超过 20 字时优先在逗号处截断，保证不超过 TITLE_MAX 个字。
 */
export const TITLE_MAX = 20;

const BLOCK_END = /<\/(p|div|li|h[1-6]|tr|blockquote|pre)>|<br\s*\/?>/gi;

/** 富文本转纯文本，块级元素换行 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(BLOCK_END, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Bug 模板里的占位文字和小标题，不当作内容 */
const PLACEHOLDERS = new Set(["进入哪个页面", "做了什么操作", "在什么条件下出现", "应该发生什么", "实际发生了什么，附报错信息或录屏"]);
const HEADINGS = /^(复现步骤|重现步骤|操作步骤|预期结果|期望结果|实际结果|问题描述|需求描述|需求背景|背景|目标|验收标准|注意事项|备注|描述|现象|环境)[:：]?$/;
const PREFIX =
  /^(?:【[^】]{0,12}】|\[[^\]]{0,12}\]|(?:问题描述|需求描述|问题|需求|现象|描述|背景|bug|BUG|Bug)\s*[:：]|(?:\d{1,2}|[一二三四五六七八九十])\s*[.、．)）]\s*|[-*•·●○]\s*|(?:用户|客户|业务)?反馈[:：，,]?|(?:目前|现在|当前)[，,]?|(?:麻烦|烦请|请|希望|建议|能否|能不能|是否可以|可不可以|需要|想要|帮忙)\s*)+/;

const chars = (s: string) => Array.from(s);
const TRIM_PUNCT = /^[\s，,。．.、；;：:！!？?…~～\-—_]+|[\s，,。．.、；;：:！!？?…~～\-—_（(【\[]+$/g;

function clean(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const n = t.replace(PREFIX, "").trim();
    if (n === t) break;
    t = n;
  }
  // 去掉括号里的补充说明（去掉后还剩足够内容时）和「…的问题需要修复」之类的尾巴
  const noParen = t.replace(/\s*[（(][^（）()]{0,30}[)）]\s*/g, " ").replace(/\s+/g, " ").trim();
  if ((noParen.match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length >= 4) t = noParen;
  for (let i = 0; i < 2; i++) t = t.replace(/[，,]?(需要|需|待|请)(尽快)?(修复|处理|解决|跟进|优化)$|(的)?问题$/, "").trim();
  if (!t) t = s.trim();
  return t.replace(/(一下|下吧|吧|呢|哈|啊|呀)([。！!？?]*)$/, "$2").replace(TRIM_PUNCT, "");
}

/** 截到 max 个字以内：先尽量按逗号分句累加，第一句就太长时硬截 */
export function clampTitle(s: string, max = TITLE_MAX): string {
  const t = s.replace(TRIM_PUNCT, "");
  if (chars(t).length <= max) return t;
  // 冒号、括号前也是自然断点：「独立 Bug 看板：Open/进行中/已关闭」→「独立 Bug 看板」
  const clauses = t.split(/(?<=[，,、；;])|(?=[：:（(【\[])/);
  let acc = "";
  for (const c of clauses) {
    if (chars(acc + c).length > max) break;
    acc += c;
  }
  acc = acc.replace(TRIM_PUNCT, "");
  if (chars(acc).length >= Math.min(8, max)) return acc;
  return chars(t).slice(0, max).join("").replace(TRIM_PUNCT, "");
}

/** 从描述里抽出标题；没有可用内容时返回空串 */
export function titleFromText(text: string, kind: "requirement" | "bug" = "requirement"): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !PLACEHOLDERS.has(l));
  // Bug 优先取「实际结果」段：那里写的才是现象
  let pool = lines;
  if (kind === "bug") {
    const i = lines.findIndex((l) => /^实际结果[:：]?$/.test(l));
    if (i >= 0 && lines[i + 1] && !HEADINGS.test(lines[i + 1])) pool = [...lines.slice(i + 1), ...lines.slice(0, i)];
  }
  for (const line of pool) {
    if (HEADINGS.test(line)) continue;
    for (const sentence of line.split(/(?<=[。！!？?；;])/)) {
      const t = clean(sentence);
      if ((t.match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length >= 4) return clampTitle(t);
    }
  }
  return "";
}

export function titleFromHtml(html: string, kind: "requirement" | "bug" = "requirement"): string {
  return titleFromText(htmlToText(html), kind);
}

/** 前端调用：先请服务端（配置了大模型时用 AI），失败时用本地规则 */
export async function generateTitle(html: string, kind: "requirement" | "bug"): Promise<{ title: string; source: "ai" | "rules" }> {
  try {
    const res = await fetch("/api/title-gen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html, kind }),
    });
    if (res.ok) {
      const d = (await res.json()) as { title?: string; source?: "ai" | "rules" };
      if (d.title) return { title: d.title, source: d.source || "rules" };
    }
  } catch {
    /* 网络失败走本地规则 */
  }
  return { title: titleFromHtml(html, kind), source: "rules" };
}
