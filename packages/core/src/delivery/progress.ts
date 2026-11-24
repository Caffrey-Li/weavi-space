import { prisma } from "@pm-collab/db/prisma";
import type { Prisma } from "@prisma/client";
import { chatStream, isMaxTokensError, type ChatMessage, type StreamResult } from "../ai/providers";

/**
 * 需求交付生成 PRD / 用例的进度（T29）：模型流式输出，边收边把阶段、思考字数、正文字数、正文预览写进 deliveries.jobProgress（最多一秒写一次），
 * 面板轮询显示；超过一段时间没有新内容由面板提示「可能卡住」，3 分钟没有新内容自动停止。用户可以随时停止。
 */
export type GenWhat = "prd" | "cases" | "prototype" | "review";
const STATUS_FIELD: Record<GenWhat, string> = { prd: "prdStatus", cases: "casesStatus", prototype: "protoStatus", review: "reviewStatus" };
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

/**
 * T53 实时文档：生成中的完整正文只放在本进程内存里（不落库），文档区按它实时显示。
 * 生成 PRD / 用例由 Tracker 写；测试报告由 skillReport 写。生成结束（成功、失败、停止）就删掉。
 */
export type LiveWhat = GenWhat | "report" | "chat";
type Live = { text: string; think: string; title: string; startedAt: number; lastAt: number };
const lives = new Map<string, Live>();
const LIVE_MAX = 300_000;
export function liveStart(id: string, what: LiveWhat, title: string) {
  const now = Date.now();
  lives.set(`${id}:${what}`, { text: "", think: "", title, startedAt: now, lastAt: now });
}
export function liveAppend(id: string, what: LiveWhat, s: string) {
  const l = lives.get(`${id}:${what}`);
  if (!l || l.text.length >= LIVE_MAX) return;
  l.text += s;
  l.lastAt = Date.now();
}
/** 推理模型的思考过程（只留最后 6 万字）：正文还没开始写时，文档区先显示构思草稿 */
export function liveThink(id: string, what: LiveWhat, s: string) {
  const l = lives.get(`${id}:${what}`);
  if (!l) return;
  l.think = (l.think + s).slice(-60_000);
  l.lastAt = Date.now();
}
export function liveEnd(id: string, what: LiveWhat) {
  lives.delete(`${id}:${what}`);
}
export function liveGet(id: string, what: LiveWhat): Live | null {
  return lives.get(`${id}:${what}`) ?? null;
}

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
      liveThink(this.id, this.p.what, s);
      this.p.thinkPreview = this.thinkTail;
      if (this.p.stage === "connect") this.p.stage = "think";
    } else {
      this.p.textChars += s.length;
      this.p.writeStartedAt ??= now;
      this.p.stage = "write";
      this.tail = (this.tail + s).slice(-PREVIEW_CHARS);
      liveAppend(this.id, this.p.what, s);
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
      .updateMany({ where: { id: this.id, [STATUS_FIELD[this.p.what]]: "generating" }, data: { jobProgress: this.p as unknown as Prisma.InputJsonObject } })
      .catch(() => undefined);
  }
  /** 重试前清空实时正文，避免两次输出拼在一起 */
  resetLive() {
    const l = lives.get(`${this.id}:${this.p.what}`);
    if (l) {
      l.text = "";
      l.think = "";
    }
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
  if (controllers.get(key(id, what)) === c) {
    controllers.delete(key(id, what));
    liveEnd(id, what);
  }
}
/** 停止：本进程里有正在跑的就中止；返回是否找到 */
export function abortGeneration(id: string, what: GenWhat) {
  const c = controllers.get(key(id, what));
  if (!c) return false;
  c.abort(new Error("你停止了生成"));
  return true;
}

/**
 * 流式生成正文：先按较大的输出上限请求（推理模型思考也占额度），厂商不认这么大时退回 8000。
 * 11-23：默认关掉模型思考（think = false），拿到资料直接写正文，左侧实时文档一开始就是最终样式；AI 评审传 true 保留思考。
 */
export async function generate(
  cred: Parameters<typeof chatStream>[0],
  model: string,
  system: string,
  messages: ChatMessage[],
  tracker: Tracker,
  signal: AbortSignal,
  maxTokens = 32_000,
  think = false,
): Promise<StreamResult> {
  const run = (limit: number) => {
    const t0 = Date.now();
    let first = true;
    return chatStream(cred, model, system, messages, limit, {
      signal,
      idleMs: IDLE_STOP_MS,
      noThink: !think,
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
      tracker.resetLive();
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
