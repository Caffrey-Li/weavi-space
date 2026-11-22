"use client";

import { useSyncExternalStore } from "react";

/**
 * T52 PRD 对照修改：交付面板把「待确认的修改」放进这里，PRD 正文（DocRevisions）按修订标记显示，
 * 在正文里接受 / 拒绝时调用面板给的 act。只在浏览器里，不落库。
 */
export type Rev = { messageId: string; id: string; no: number; title: string; op: string; index: number; html: string };
export type RevAct = (messageId: string, id: string, op: "apply" | "ignore") => Promise<void>;
type State = { pageId: string; items: Rev[]; act: RevAct; busy: string | null; readOnly?: boolean } | null;

let state: State = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setRevisions(next: State) {
  state = next;
  emit();
}

export function setRevBusy(busy: string | null) {
  if (!state) return;
  state = { ...state, busy };
  emit();
}

export function useRevisions(pageId: string): State {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => null,
  );
  return s && s.pageId === pageId && s.items.length ? s : null;
}

/** 滚动到正文里的某处修订 */
export function scrollToRev(id: string) {
  const el = document.getElementById(`rev-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("is-flash");
  window.setTimeout(() => el.classList.remove("is-flash"), 1200);
  return true;
}

/**
 * T53 实时文档：交付面板知道正在生成什么（PRD / 用例 / 报告），放进这里；
 * 文档区（LiveDocSwitch）看到就换成实时显示，自己轮询 /api/deliveries/:id/live。
 */
export type LiveState = { pageId: string; deliveryId: string; what: "prd" | "cases" | "report" | "prototype" | "review"; title: string } | null;
let live: LiveState = null;
const liveListeners = new Set<() => void>();
export function setLiveDoc(next: LiveState) {
  if (live?.pageId === next?.pageId && live?.deliveryId === next?.deliveryId && live?.what === next?.what && live?.title === next?.title) return;
  live = next;
  liveListeners.forEach((l) => l());
}
export function useLiveDoc(pageId: string): LiveState {
  const s = useSyncExternalStore(
    (cb) => {
      liveListeners.add(cb);
      return () => liveListeners.delete(cb);
    },
    () => live,
    () => null,
  );
  return s && s.pageId === pageId ? s : null;
}

/**
 * T57 测试执行实况：交付面板把当前一轮（或最近一轮）的结果放进这里，用例页左侧按用例对照显示执行过程和结论。
 */
export type RunLiveResult = { code: string; status: string; failedStep: number | null; message: string | null; screenshotUrl: string | null; durationMs: number | null; mode: string };
export type RunLive = { pageId: string; id: string; round: number; status: string; total: number; doneCount: number; currentCode: string | null; currentStep: number | null; createdAt: string; finalized: boolean; results: RunLiveResult[] } | null;
let runLive: RunLive = null;
const runListeners = new Set<() => void>();
export function setRunLive(next: RunLive) {
  runLive = next;
  runListeners.forEach((l) => l());
}
export function useRunLive(pageId: string): RunLive {
  const s = useSyncExternalStore(
    (cb) => {
      runListeners.add(cb);
      return () => runListeners.delete(cb);
    },
    () => runLive,
    () => null,
  );
  return s && s.pageId === pageId ? s : null;
}
