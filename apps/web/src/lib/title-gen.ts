import { TITLE_MAX, clampTitle, htmlToText, titleFromText } from "./title-gen-shared";

/** 服务端生成标题：配置了 ANTHROPIC_API_KEY 时让 Claude 提炼，否则 / 失败时用规则 */
export async function generateTitleServer(html: string, kind: "requirement" | "bug"): Promise<{ title: string; source: "ai" | "rules" }> {
  const text = htmlToText(html).replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  const rules = titleFromText(text, kind);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return { title: rules, source: "rules" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 60,
        system: [
          `你为产品研发系统里的${kind === "bug" ? " Bug" : "需求"}起标题。`,
          `根据用户给出的描述提炼核心内容，输出一个不超过 ${TITLE_MAX} 个字的简体中文标题。`,
          kind === "bug" ? "写清「在哪里 + 出现什么问题」，不写复现步骤。" : "写清「要做什么 / 改什么」，不写背景和客套话。",
          "只输出标题本身，不加引号、编号、句号或任何解释。",
        ].join("\n"),
        messages: [{ role: "user", content: text }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").split("\n")[0].replace(/^["“「『]|["”」』]$/g, "").trim();
    const title = clampTitle(out);
    return title ? { title, source: "ai" } : { title: rules, source: "rules" };
  } catch {
    return { title: rules, source: "rules" };
  } finally {
    clearTimeout(timer);
  }
}
