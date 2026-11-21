import { afterEach, describe, expect, it, vi } from "vitest";
import { chatLong } from "@pm-collab/core/ai/providers";
import { rememberDocument, withDocuments } from "@pm-collab/core/agent/loop";

/** 11-21 PRD 不完整：长文输出上限 16000、截断自动续写；Agent 把个人能力生成的完整文档附在回复后 */
const enc = new TextEncoder();
const sseRes = (lines: string[]) =>
  new Response(new ReadableStream<Uint8Array>({ start(c) { for (const l of lines) c.enqueue(enc.encode(`${l}\n`)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
const chunk = (text: string, finish?: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text }, ...(finish ? { finish_reason: finish } : {}) }] })}`;
const cred = { provider: "deepseek", apiKey: "k" };
afterEach(() => vi.unstubAllGlobals());

describe("chatLong", () => {
  it("写到上限时自动续写并拼接，续写请求带上已写内容", async () => {
    const bodies: { max_tokens: number; messages: { role: string; content: string }[] }[] = [];
    const replies = [[chunk("# PRD\n第一部分", "length")], [chunk("\n第二部分", "stop")]];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), sseRes([...replies.shift()!, "data: [DONE]"]))));
    const out = await chatLong(cred, "m", "sys", [{ role: "user", content: "写 PRD" }]);
    expect(out.text).toBe("# PRD\n第一部分\n第二部分");
    expect(out).toMatchObject({ truncated: false, continued: 1 });
    expect(bodies[0].max_tokens).toBe(16000);
    expect(bodies[1].messages.slice(-2).map((m) => m.role)).toEqual(["assistant", "user"]);
  });
  it("厂商不接受 16000 时退回调用方给的上限", async () => {
    const seen: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const max = JSON.parse(String(init.body)).max_tokens;
      seen.push(max);
      return max > 8000 ? new Response(JSON.stringify({ error: { message: "max_tokens is too large" } }), { status: 400 }) : sseRes([chunk("ok", "stop"), "data: [DONE]"]);
    }));
    expect((await chatLong(cred, "m", "sys", [{ role: "user", content: "x" }], { fallbackTokens: 8000 })).text).toBe("ok");
    expect(seen).toEqual([16000, 8000]);
  });
});

describe("Agent 附上完整文档", () => {
  it("回复里没有原文时附在后面；已经包含就不重复", () => {
    expect(withDocuments("t-none", "做完了")).toBe("做完了");
    const prd = "# 登录 PRD\n" + "很长的正文".repeat(3000);
    rememberDocument("t1", "run_skill", true, { text: prd, html: false });
    const out = withDocuments("t1", "已经按 PRD 能力生成，见下文。");
    expect(out.startsWith("已经按 PRD 能力生成")).toBe(true);
    expect(out.endsWith(prd)).toBe(true);
    rememberDocument("t2", "run_skill", true, { text: prd });
    expect(withDocuments("t2", prd)).toBe(prd);
    rememberDocument("t3", "run_skill", false, { text: prd });
    rememberDocument("t3", "list_requirements", true, { text: prd });
    expect(withDocuments("t3", "x")).toBe("x");
  });
});
