/**
 * 模型厂商：除 Anthropic 外都按 OpenAI 兼容接口调用（/models、/chat/completions）。
 * Gemini 用官方的 OpenAI 兼容地址；通义千问用 DashScope 兼容模式；豆包用火山方舟。
 */
export const AI_PROVIDERS = [
  { key: "anthropic", label: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { key: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  { key: "gemini", label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { key: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { key: "qwen", label: "通义千问", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { key: "zhipu", label: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { key: "moonshot", label: "Kimi（月之暗面）", kind: "openai", baseUrl: "https://api.moonshot.cn/v1" },
  { key: "doubao", label: "豆包（火山方舟）", kind: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { key: "openai_compat", label: "OpenAI 兼容（自定义地址）", kind: "openai", baseUrl: "" },
] as const;
export type AiProviderKey = (typeof AI_PROVIDERS)[number]["key"];

export function providerMeta(key: string) {
  return AI_PROVIDERS.find((p) => p.key === key) || null;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResult = { text: string; inputTokens: number; outputTokens: number };
type Cred = { provider: string; baseUrl?: string | null; apiKey: string };

/** 内网 / 本机地址：默认禁止（防止借模型接口探测服务器内网），本机测试时设 AI_ALLOW_PRIVATE_BASEURL=1 */
export function privateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h === "0.0.0.0" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h)
  );
}

export function checkBaseUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("接口地址格式不对");
  }
  const allowPrivate = process.env.AI_ALLOW_PRIVATE_BASEURL === "1";
  if (privateHost(u.hostname) && !allowPrivate) throw new Error("不能使用内网或本机地址");
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) throw new Error("接口地址需要以 https:// 开头");
  return raw;
}

function base(c: Cred) {
  const meta = providerMeta(c.provider);
  return checkBaseUrl((c.baseUrl || meta?.baseUrl || "").replace(/\/+$/, ""));
}

async function call(url: string, init: RequestInit, timeoutMs = 60_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as { message?: string } | undefined)?.message || (data.message as string) || `HTTP ${res.status}`;
      throw new Error(String(err).slice(0, 200));
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** 用 Key 拉取可用模型 */
export async function listRemoteModels(c: Cred): Promise<string[]> {
  const meta = providerMeta(c.provider);
  if (!meta) throw new Error("不支持的厂商");
  if (meta.kind === "anthropic") {
    const d = await call(`${base(c)}/models?limit=100`, { headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" } }, 20_000);
    return ((d.data as { id: string }[]) || []).map((m) => m.id).sort();
  }
  const d = await call(`${base(c)}/models`, { headers: { Authorization: `Bearer ${c.apiKey}` } }, 20_000);
  const ids = ((d.data as { id: string }[]) || []).map((m) => String(m.id).replace(/^models\//, ""));
  return Array.from(new Set(ids)).sort();
}

/** 对话（不流式） */
export async function chatOnce(c: Cred, model: string, system: string, messages: ChatMessage[], maxTokens = 2000): Promise<ChatResult> {
  const meta = providerMeta(c.provider);
  if (!meta) throw new Error("不支持的厂商");
  if (meta.kind === "anthropic") {
    const d = await call(`${base(c)}/messages`, {
      method: "POST",
      headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    const text = ((d.content as { type: string; text?: string }[]) || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const u = (d.usage || {}) as { input_tokens?: number; output_tokens?: number };
    return { text, inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0 };
  }
  const d = await call(`${base(c)}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] }),
  });
  const choice = ((d.choices as { message?: { content?: string; reasoning_content?: string } }[]) || [])[0];
  const u = (d.usage || {}) as { prompt_tokens?: number; completion_tokens?: number };
  // 推理模型可能把额度全用在思考上，正文是空的：说清楚原因，而不是返回空白
  if (!choice?.message?.content && choice?.message?.reasoning_content) throw new Error("模型只输出了思考过程，没有写出正文（可能是推理模型的输出额度不够），请换成非推理模型重试");
  return { text: choice?.message?.content || "", inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 };
}

// ---------- 工具调用（系统内 Agent，T27） ----------

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
/** Agent 对话的统一格式，调用时再转成各家格式 */
export type AgentMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolChatResult = { text: string; toolCalls: ToolCall[]; inputTokens: number; outputTokens: number; /** 写到输出上限被截断 */ truncated?: boolean };

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw || "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** OpenAI 兼容格式的消息 */
export function toOpenAiMessages(system: string, msgs: AgentMsg[]) {
  return [
    { role: "system", content: system },
    ...msgs.map((m) =>
      m.role === "tool"
        ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
        : m.role === "assistant" && m.toolCalls?.length
          ? { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : { role: m.role, content: m.content },
    ),
  ];
}

/** Anthropic 格式：工具结果是 user 消息里的 tool_result 块，相邻的要合并成一条 */
export function toAnthropicMessages(msgs: AgentMsg[]) {
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (const m of msgs) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && (last.content[0] as { type?: string })?.type === "tool_result") last.content.push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "（继续）" }] });
    } else out.push({ role: "user", content: [{ type: "text", text: m.content }] });
  }
  return out;
}

/** 带工具的一轮对话（不流式）：返回文字和要调用的工具 */
export async function chatWithTools(c: Cred, model: string, system: string, messages: AgentMsg[], tools: ToolSpec[], maxTokens = 2000): Promise<ToolChatResult> {
  const meta = providerMeta(c.provider);
  if (!meta) throw new Error("不支持的厂商");
  if (meta.kind === "anthropic") {
    const d = await call(
      `${base(c)}/messages`,
      {
        method: "POST",
        headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: toAnthropicMessages(messages), tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
      },
      90_000,
    );
    const blocks = (d.content as { type: string; text?: string; id?: string; name?: string; input?: unknown }[]) || [];
    const u = (d.usage || {}) as { input_tokens?: number; output_tokens?: number };
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), args: parseArgs(b.input) })),
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      truncated: d.stop_reason === "max_tokens",
    };
  }
  const d = await call(
    `${base(c)}/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: toOpenAiMessages(system, messages), tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" }),
    },
    90_000,
  );
  const choice0 = ((d.choices as { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[]) || [])[0] || {};
  const msg = choice0.message || {};
  const u = (d.usage || {}) as { prompt_tokens?: number; completion_tokens?: number };
  return {
    text: msg.content || "",
    toolCalls: (msg.tool_calls || []).map((t, i) => ({ id: String(t.id || `call_${i}`), name: String(t.function?.name || ""), args: parseArgs(t.function?.arguments) })),
    inputTokens: u.prompt_tokens || 0,
    outputTokens: u.completion_tokens || 0,
    truncated: choice0.finish_reason === "length",
  };
}

// ---------- 流式输出（T29：需求交付生成 PRD / 用例时显示进度） ----------

export type StreamDelta = { kind: "text" | "think"; text: string };
export type StreamResult = ChatResult & { thinkChars: number; finishReason: string };
export class StreamIdleError extends Error {}

/** 逐行读 SSE：返回每个 data: 后面的内容 */
export async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new Error("已停止");
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

/**
 * 流式对话：边收边回调 onDelta（正文 / 思考分开）。idleMs 内没有任何新数据就中止（防止卡死），totalMs 是总时长上限。
 * 厂商不支持流式、直接回了整段 JSON 时也能处理。
 */
export async function chatStream(
  c: Cred,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  opts: { onDelta?: (d: StreamDelta) => void; signal?: AbortSignal; idleMs?: number; totalMs?: number } = {},
): Promise<StreamResult> {
  const meta = providerMeta(c.provider);
  if (!meta) throw new Error("不支持的厂商");
  const idleMs = opts.idleMs ?? 180_000;
  const ctrl = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctrl.abort(new StreamIdleError(`模型 ${Math.round(idleMs / 1000)} 秒没有返回新内容，已自动停止`)), idleMs);
  };
  const total = setTimeout(() => ctrl.abort(new StreamIdleError(`超过 ${Math.round((opts.totalMs ?? 900_000) / 60_000)} 分钟还没写完，已自动停止`)), opts.totalMs ?? 900_000);
  const onOuterAbort = () => ctrl.abort(opts.signal?.reason ?? new Error("已停止"));
  opts.signal?.addEventListener("abort", onOuterAbort);
  if (opts.signal?.aborted) onOuterAbort();
  let text = "";
  let thinkChars = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "";
  const emit = (kind: "text" | "think", s: string) => {
    if (!s) return;
    if (kind === "text") text += s;
    else thinkChars += s.length;
    opts.onDelta?.({ kind, text: s });
  };
  try {
    kick();
    const anthropic = meta.kind === "anthropic";
    const res = await fetch(anthropic ? `${base(c)}/messages` : `${base(c)}/chat/completions`, {
      method: "POST",
      cache: "no-store",
      signal: ctrl.signal,
      headers: anthropic
        ? { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", accept: "text/event-stream" }
        : { Authorization: `Bearer ${c.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(
        anthropic
          ? { model, max_tokens: maxTokens, system, messages, stream: true }
          : { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages], stream: true, stream_options: { include_usage: true } },
      ),
    });
    kick();
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = (data.error as { message?: string } | undefined)?.message || (data.message as string) || `HTTP ${res.status}`;
      throw new Error(String(err).slice(0, 200));
    }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("event-stream") || !res.body) {
      // 不支持流式：按普通响应处理
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (anthropic) {
        for (const b of (d.content as { type: string; text?: string; thinking?: string }[]) || []) emit(b.type === "text" ? "text" : "think", b.text || b.thinking || "");
        const u = (d.usage || {}) as { input_tokens?: number; output_tokens?: number };
        return { text, thinkChars, inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, finishReason: String(d.stop_reason || "") };
      }
      const ch = ((d.choices as { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]) || [])[0];
      emit("think", ch?.message?.reasoning_content || "");
      emit("text", ch?.message?.content || "");
      const u = (d.usage || {}) as { prompt_tokens?: number; completion_tokens?: number };
      return { text, thinkChars, inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0, finishReason: String(ch?.finish_reason || "") };
    }
    for await (const raw of sseData(res.body, ctrl.signal)) {
      kick();
      if (!raw || raw === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (anthropic) {
        if (ev.type === "message_start") inputTokens = ((ev.message as { usage?: { input_tokens?: number } })?.usage?.input_tokens) || 0;
        else if (ev.type === "content_block_delta") {
          const d = ev.delta as { type?: string; text?: string; thinking?: string };
          if (d?.type === "text_delta") emit("text", d.text || "");
          else if (d?.type === "thinking_delta") emit("think", d.thinking || "");
        } else if (ev.type === "message_delta") {
          outputTokens = ((ev.usage as { output_tokens?: number })?.output_tokens) || outputTokens;
          finishReason = String((ev.delta as { stop_reason?: string })?.stop_reason || finishReason);
        } else if (ev.type === "error") throw new Error(String((ev.error as { message?: string })?.message || "模型返回错误").slice(0, 200));
        continue;
      }
      const ch = ((ev.choices as { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[]) || [])[0];
      if (ch) {
        emit("think", ch.delta?.reasoning_content || ch.delta?.reasoning || "");
        emit("text", ch.delta?.content || "");
        if (ch.finish_reason) finishReason = ch.finish_reason;
      }
      const u = ev.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (u) {
        inputTokens = u.prompt_tokens || inputTokens;
        outputTokens = u.completion_tokens || outputTokens;
      }
      if (ev.error) throw new Error(String((ev.error as { message?: string })?.message || "模型返回错误").slice(0, 200));
    }
    return { text, thinkChars, inputTokens, outputTokens, finishReason };
  } catch (e) {
    const reason = ctrl.signal.aborted ? ctrl.signal.reason : null;
    if (reason instanceof Error) throw reason;
    throw e;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(total);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** 输出上限超过模型允许范围时的报错（各家措辞不同） */
export function isMaxTokensError(msg: string) {
  return /max[_ ]?tokens|max_output|maximum.*tokens|output.*limit|range of|invalid.*token/i.test(msg);
}

/** 长文输出用的输出上限：先给 16000，厂商不接受时退回调用方的上限 */
export const LONG_MAX_TOKENS = 16_000;
const CONTINUE_PROMPT = "上面的内容因为长度限制中断了。请从中断的地方直接接着写，不要重复已经写过的内容，不要加任何说明。";

/**
 * 长文输出（PRD、文档、报告）：流式收（推理模型的思考不算正文），输出上限给大；
 * 写到上限被截断时自动让模型接着写，最多续写 maxContinue 次，拼成一份完整结果。
 */
export async function chatLong(
  c: Cred,
  model: string,
  system: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; fallbackTokens?: number; maxContinue?: number; idleMs?: number } = {},
): Promise<ChatResult & { truncated: boolean; continued: number }> {
  const want = opts.maxTokens ?? LONG_MAX_TOKENS;
  let limit = want;
  const once = async (msgs: ChatMessage[]) => {
    try {
      return await chatStream(c, model, system, msgs, limit, { idleMs: opts.idleMs });
    } catch (e) {
      if (limit === (opts.fallbackTokens ?? 4000) || !isMaxTokensError((e as Error).message)) throw e;
      limit = opts.fallbackTokens ?? 4000;
      return chatStream(c, model, system, msgs, limit, { idleMs: opts.idleMs });
    }
  };
  let out = await once(messages);
  if (!out.text.trim() && out.thinkChars) throw new Error("模型只输出了思考过程，没有写出正文（可能是推理模型的输出额度不够），请换成非推理模型重试");
  let text = out.text;
  let inputTokens = out.inputTokens;
  let outputTokens = out.outputTokens;
  let continued = 0;
  const cut = (r: { finishReason: string }) => r.finishReason === "length" || r.finishReason === "max_tokens";
  let truncated = cut(out);
  while (truncated && continued < (opts.maxContinue ?? 3)) {
    continued++;
    out = await once([...messages, { role: "assistant", content: text }, { role: "user", content: CONTINUE_PROMPT }]);
    text += out.text;
    inputTokens += out.inputTokens;
    outputTokens += out.outputTokens;
    truncated = cut(out);
    if (!out.text.trim()) break;
  }
  return { text, inputTokens, outputTokens, truncated, continued };
}
