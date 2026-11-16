"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cssTimeMs } from "./useOverlayPhase";

type Tone = "success" | "error" | "info";

export type ToastInput = {
  message: string;
  tone?: Tone;
  /** 可选的单个动作，例如「撤销」「查看」 */
  action?: { label: string; onClick: () => void };
  /** 毫秒；错误默认常驻直到关闭 */
  duration?: number;
};

type ToastItem = ToastInput & { id: number; tone: Tone };

type ToastApi = {
  show: (t: ToastInput) => number;
  success: (message: string, action?: ToastInput["action"]) => number;
  error: (message: string, action?: ToastInput["action"]) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const noop: ToastApi = {
  show: () => 0,
  success: () => 0,
  error: () => 0,
  dismiss: () => undefined,
};

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

/**
 * M12 Toast：成功 4 秒自动消失，悬停/聚焦时暂停并在离开后继续剩余时间；
 * 错误常驻直到关闭；同文案去重；不抢焦点，用 live region 宣布。
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const seq = useRef(0);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = ++seq.current;
    const tone = input.tone ?? "info";
    setItems((list) => {
      const rest = list.filter((t) => !(t.message === input.message && t.tone === tone));
      return [...rest, { ...input, tone, id }].slice(-4);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (message, action) => show({ message, action, tone: "success" }),
      error: (message, action) => show({ message, action, tone: "error" }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div className="toast-region" aria-label="通知">
              <div role="status" aria-live="polite" className="toast-stack">
                {items
                  .filter((t) => t.tone !== "error")
                  .map((t) => (
                    <ToastCard key={t.id} item={t} onDismiss={dismiss} />
                  ))}
              </div>
              <div role="alert" aria-live="assertive" className="toast-stack">
                {items
                  .filter((t) => t.tone === "error")
                  .map((t) => (
                    <ToastCard key={t.id} item={t} onDismiss={dismiss} />
                  ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const remaining = useRef<number | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const paused = useRef(false);

  const lifetime =
    item.duration ?? (item.tone === "error" ? 0 : cssTimeMs("--clarity-toast-lifetime", 4000) || 4000);

  const start = useCallback(() => {
    if (!lifetime) return;
    const left = remaining.current ?? lifetime;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => onDismiss(item.id), left);
  }, [item.id, lifetime, onDismiss]);

  const pause = useCallback(() => {
    if (!lifetime || paused.current) return;
    paused.current = true;
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    const elapsed = Date.now() - startedAt.current;
    remaining.current = Math.max(800, (remaining.current ?? lifetime) - elapsed);
  }, [lifetime]);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    start();
  }, [start]);

  useEffect(() => {
    start();
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [start]);

  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertCircle : Info;

  return (
    <div
      className={`toast toast-${item.tone}`}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
    >
      <Icon size={16} aria-hidden="true" className="toast-icon" />
      <p className="toast-message">{item.message}</p>
      {item.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onDismiss(item.id);
            item.action?.onClick();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => onDismiss(item.id)}>
        <X size={14} />
      </button>
    </div>
  );
}
