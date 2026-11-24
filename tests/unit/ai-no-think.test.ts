import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStream, noThinkParams } from "@pm-collab/core/ai/providers";

/** 11-23 写长文档时关闭模型思考：按厂商传参数；厂商拒绝（400 / 422）时去掉参数重试一次 */
const enc = new TextEncoder();
const sseRes = (lines: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(`${l}\n`));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const ok = () => sseRes(['data: {"choices":[{"delta":{"content":"# PRD"},"finish_reason":"stop"}]}', "data: [DONE]"]);
const msgs = [{ role: "user" as const, content: "写 PRD" }];
const bodyOf = (m: ReturnType<typeof vi.fn>, i: number) => JSON.parse((m.mock.calls[i] as unknown as [string, { body: string }])[1].body);
afterEach(() => vi.unstubAllGlobals());

describe("关闭思考", () => {
  it("各厂商的参数", () => {
    for (const p of ["deepseek", "zhipu", "moonshot", "doubao"]) expect(noThinkParams(p)).toEqual({ thinking: { type: "disabled" } });
    expect(noThinkParams("qwen")).toEqual({ enable_thinking: false });
    for (const p of ["anthropic", "openai", "gemini", "openai_compat"]) expect(noThinkParams(p)).toBeNull();
  });

  it("noThink 时请求带上参数；不带 noThink 时不带", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    await chatStream({ provider: "deepseek", apiKey: "k" }, "deepseek-flash", "sys", msgs, 8000, { noThink: true });
    expect(bodyOf(f, 0).thinking).toEqual({ type: "disabled" });
    await chatStream({ provider: "deepseek", apiKey: "k" }, "deepseek-flash", "sys", msgs, 8000);
    expect(bodyOf(f, 1).thinking).toBeUndefined();
  });

  it("厂商拒绝参数时去掉再试一次", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "thinking disabled is not supported" } }), { status: 400 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    const out = await chatStream({ provider: "zhipu", apiKey: "k" }, "glm-5.3", "sys", msgs, 8000, { noThink: true });
    expect(out.text).toBe("# PRD");
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 0).thinking).toEqual({ type: "disabled" });
    expect(bodyOf(f, 1).thinking).toBeUndefined();
  });

  it("没有关闭参数的厂商只请求一次", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 }));
    vi.stubGlobal("fetch", f);
    await expect(chatStream({ provider: "openai", apiKey: "k" }, "gpt-x", "sys", msgs, 8000, { noThink: true })).rejects.toThrow("bad");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
