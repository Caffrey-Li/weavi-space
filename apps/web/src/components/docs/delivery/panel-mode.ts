"use client";

import { useSyncExternalStore } from "react";

/** 需求交付面板：closed 收起 | open 默认 360 宽 | wide 铺满主信息区。按人记在浏览器里 */
export type PanelMode = "closed" | "open" | "wide";
const KEY = "pm-delivery-panel";
const listeners = new Set<() => void>();
let memory: PanelMode | null = null;

function read(): PanelMode | null {
  if (memory) return memory;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "open" || v === "wide" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}

export function setPanelMode(m: PanelMode) {
  memory = m;
  try {
    window.localStorage.setItem(KEY, m);
  } catch {
    /* 隐私模式等：只在本次会话里记住 */
  }
  for (const l of listeners) l();
}

export function usePanelMode(fallback: PanelMode): PanelMode {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
  return v ?? fallback;
}

/** T52：「展开」是否铺满主区。PRD / 用例在自己的页面上时不铺满（只把对话栏加宽），文档始终可见 */
let cover = true;
const coverListeners = new Set<() => void>();
export function setPanelCover(v: boolean) {
  if (cover === v) return;
  cover = v;
  for (const l of coverListeners) l();
}
export function usePanelCover(): boolean {
  return useSyncExternalStore(
    (cb) => {
      coverListeners.add(cb);
      return () => coverListeners.delete(cb);
    },
    () => cover,
    () => true,
  );
}
