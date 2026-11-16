import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStream, isMaxTokensError, StreamIdleError } from "@pm-collab/core/ai/providers";
import { emptyReason } from "@pm-collab/core/delivery/progress";

/** 流式输出（T29）：OpenAI 兼容 / Anthropic 的 SSE、推理模型的思考、非流式回退、空闲超时、停止 */
const enc = new TextEncoder();
function sse(lines: string[], gapMs = 0) {
  return new ReadableStream<Uint8Array>({
    async start(c) {
      for (const l of lines) {
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
        c.enqueue(enc.encode(`${l}\n`));
      }
      c.close();
    },
  });
}
const sseRes = (lines: string[], gapMs = 0) => new Response(sse(lines, gapMs), { headers: { "content-type": "text/event-stream" } });
const cred = { provider: "deepseek", apiKey: "k" };
const msgs = [{ role: "user" as const, content: "写 PRD" }];
afterEach(() => vi.unstubAllGlobals());

describe("chatStream", () => {
  it("OpenAI 兼容：思考和正文分开，带用量和结束原因", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"reasoning_content":"先想想"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"再想想"}}]}',
      'data: {"choices":[{"delta":{"content":"# PRD"}}]}',
      'data: {"choices":[{"delta":{"content":"\\n正文"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22}}',
      "data: [DONE]",
    ];
    const fetchMock = vi.fn(async () => sseRes(chunks));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const out = await chatStream(cred, "deepseek-flash", "sys", msgs, 32000, { onDelta: (d) => seen.push(`${d.kind}:${d.text}`) });
    expect(out.text).toBe("# PRD\n正文");
    expect(out.thinkChars).toBe(6);
    expect(out).toMatchObject({ inputTokens: 11, outputTokens: 22, finishReason: "stop" });
    expect(seen[0]).toBe("think:先想想");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ stream: true, max_tokens: 32000, stream_options: { include_usage: true } });
  });

  it("Anthropic：text_delta / thinking_delta，用量来自 message_start 和 message_delta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseRes([
      "event: message_start",
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"嗯"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}',
    ])));
    const out = await chatStream({ provider: "anthropic", apiKey: "k" }, "claude", "sys", msgs, 1000);
    expect(out).toMatchObject({ text: "你好", thinkChars: 1, inputTokens: 5, outputTokens: 9, finishReason: "max_tokens" });
  });

  it("厂商不支持流式、回了整段 JSON：照样读出正文和思考", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "", reasoning_content: "想了很多" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 8000 } })));
    const out = await chatStream(cred, "m", "sys", msgs, 8000);
    expect(out.text).toBe("");
    expect(out.thinkChars).toBe(4);
    expect(emptyReason(out)).toContain("只输出了思考过程");
    expect(emptyReason({ ...out, thinkChars: 0 })).toBe("模型没有返回内容，请换个模型重试");
  });

  it("接口报错时带上厂商的错误信息；输出上限过大能识别", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]" } }, { status: 400 })));
    await expect(chatStream(cred, "m", "sys", msgs, 32000)).rejects.toThrow("max_tokens");
    expect(isMaxTokensError("Invalid max_tokens value, the valid range of max_tokens is [1, 8192]")).toBe(true);
    expect(isMaxTokensError("Unauthorized")).toBe(false);
  });

  it("超过空闲时间没有新数据：自动停止并说明原因", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"开头"}}]}\n'));
          init.signal.addEventListener("abort", () => c.error(init.signal.reason));
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }));
    const err = await chatStream(cred, "m", "sys", msgs, 100, { idleMs: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(StreamIdleError);
    expect(String(err.message)).toContain("没有返回新内容");
  });

  it("外部停止：立刻中止", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({ start(c) { init.signal.addEventListener("abort", () => c.error(init.signal.reason)); } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }));
    const p = chatStream(cred, "m", "sys", msgs, 100, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(new Error("你停止了生成")), 20);
    await expect(p).rejects.toThrow("你停止了生成");
  });
});
