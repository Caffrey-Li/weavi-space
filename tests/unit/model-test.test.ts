import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {} }));
import { testOneModel } from "@pm-collab/core/ai/credentials";

/** 模型连接测试（T29）：首字延迟、输出速度、思考、失败原因 */
const enc = new TextEncoder();
const sseRes = (lines: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(`${l}\n`)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
afterEach(() => vi.unstubAllGlobals());
const cred = { provider: "deepseek", apiKey: "k" };

describe("testOneModel", () => {
  it("正常：有正文，记首字延迟、速度、是否思考", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseRes([
      'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}',
      'data: {"choices":[{"delta":{"content":"连接正常"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}',
      "data: [DONE]",
    ])));
    const t = await testOneModel(cred, "deepseek-flash");
    expect(t).toMatchObject({ ok: true, thinking: true, reply: "连接正常", error: null });
    expect(t.ttftMs).not.toBeNull();
    expect(t.tokensPerSec).toBeGreaterThan(0);
  });
  it("只有思考没有正文：不可用并说明原因", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseRes(['data: {"choices":[{"delta":{"reasoning_content":"想了很久"},"finish_reason":"length"}]}', "data: [DONE]"])));
    const t = await testOneModel(cred, "m");
    expect(t.ok).toBe(false);
    expect(t.error).toContain("只返回了思考过程");
  });
  it("Key 错误：带上厂商的报错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Authentication Fails, your api key is invalid" } }, { status: 401 })));
    const t = await testOneModel(cred, "m");
    expect(t).toMatchObject({ ok: false, error: "Authentication Fails, your api key is invalid" });
  });
});
