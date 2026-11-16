import { prisma } from "@pm-collab/db/prisma";
import type { Prisma } from "@prisma/client";
import { chatStream, isMaxTokensError, type ChatMessage, type StreamResult } from "../ai/providers";

/**
 * 需求交付生成 PRD / 用例的进度（T29）：模型流式输出，边收边把阶段、思考字数、正文字数、正文预览写进 deliveries.jobProgress（最多一秒写一次），
 * 面板轮询显示；超过一段时间没有新内容由面板提示「可能卡住」，3 分钟没有新内容自动停止。用户可以随时停止。
 */
export type GenWhat = "prd" | "cases";
export type GenStage = "prepare" | "connect" | "think" | "write" | "save";
export type GenProgress = {
  what: GenWhat;
  stage: GenStage;
  model: string;
  inputChars: number;
  attachments: number;
  connectMs: number | null;
  thinkChars: number;
  textChars: number;
  preview: string;
  /** 思考过程的最后一段（面板里可展开看） */
  thinkPreview: string;
  thinkStartedAt: string | null;
  writeStartedAt: string | null;
  startedAt: string;
  lastAt: string;
  note: string | null;
};

export const IDLE_STOP_MS = 180_000;
const PREVIEW_CHARS = 1200;
const controllers = new Map<string, AbortController>();
const key = (id: string, what: GenWhat) => `${id}:${what}`;

export class Tracker {
  p: GenProgress;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private tail = "";
  private thinkTail = "";
  constructor(
    private id: string,
    init: Pick<GenProgress, "what" | "model" | "inputChars" | "attachments">,
  ) {
    const now = new Date().toISOString();
    this.p = { ...init, stage: "prepare", connectMs: null, thinkChars: 0, textChars: 0, preview: "", thinkPreview: "", thinkStartedAt: null, writeStartedAt: null, startedAt: now, lastAt: now, note: null };
  }
  async set(patch: Partial<GenProgress>) {
    Object.assign(this.p, patch, { lastAt: new Date().toISOString() });
    await this.flush();
  }
  delta(kind: "text" | "think", s: string) {
    const now = new Date().toISOString();
    if (kind === "think") {
      this.p.thinkChars += s.length;
      this.p.thinkStartedAt ??= now;
      this.thinkTail = (this.thinkTail + s).slice(-600);
      this.p.thinkPreview = this.thinkTail;
      if (this.p.stage === "connect") this.p.stage = "think";
    } else {
      this.p.textChars += s.length;
      this.p.writeStartedAt ??= now;
      this.p.stage = "write";
      this.tail = (this.tail + s).slice(-PREVIEW_CHARS);
      this.p.preview = this.tail;
    }
    this.p.lastAt = new Date().toISOString();
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1000);
  }
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
    // 只在还在生成时写，避免停止 / 失败后被晚到的进度覆盖
    await prisma.delivery
      .updateMany({ where: { id: this.id, [this.p.what === "prd" ? "prdStatus" : "casesStatus"]: "generating" }, data: { jobProgress: this.p as unknown as Prisma.InputJsonObject } })
      .catch(() => undefined);
  }
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  get pending() {
    return this.dirty;
  }
}

/** 开始一次生成：登记可停止的控制器 */
export function begin(id: string, what: GenWhat) {
  controllers.get(key(id, what))?.abort(new Error("已重新开始"));
  const c = new AbortController();
  controllers.set(key(id, what), c);
  return c;
}
export function end(id: string, what: GenWhat, c: AbortController) {
  if (controllers.get(key(id, what)) === c) controllers.delete(key(id, what));
}
/** 停止：本进程里有正在跑的就中止；返回是否找到 */
export function abortGeneration(id: string, what: GenWhat) {
  const c = controllers.get(key(id, what));
  if (!c) return false;
  c.abort(new Error("你停止了生成"));
  return true;
}

/** 流式生成正文：先按较大的输出上限请求（推理模型思考也占额度），厂商不认这么大时退回 8000 */
export async function generate(
  cred: Parameters<typeof chatStream>[0],
  model: string,
  system: string,
  messages: ChatMessage[],
  tracker: Tracker,
  signal: AbortSignal,
  maxTokens = 32_000,
): Promise<StreamResult> {
  const run = (limit: number) => {
    const t0 = Date.now();
    let first = true;
    return chatStream(cred, model, system, messages, limit, {
      signal,
      idleMs: IDLE_STOP_MS,
      onDelta: (d) => {
        if (first) {
          first = false;
          tracker.p.connectMs = Date.now() - t0;
        }
        tracker.delta(d.kind, d.text);
      },
    });
  };
  await tracker.set({ stage: "connect" });
  try {
    return await run(maxTokens);
  } catch (e) {
    if (!signal.aborted && isMaxTokensError((e as Error).message) && maxTokens > 8000) {
      await tracker.set({ stage: "connect", note: "模型不接受这么大的输出上限，改用 8000 重试" });
      return run(8000);
    }
    throw e;
  }
}

/** 正文为空时给出原因 */
export function emptyReason(out: StreamResult) {
  if (out.thinkChars > 0)
    return `模型只输出了思考过程（${out.thinkChars.toLocaleString()} 字），没有写出正文：可能是推理模型的输出额度用完了。建议换成非推理模型，或者精简材料后重试`;
  return "模型没有返回内容，请换个模型重试";
}
