"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "./Modal";

export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger：破坏性操作，初始焦点落在「取消」 */
  tone?: "default" | "danger";
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** 替代原生 confirm()：统一外观、焦点和 Esc 行为。 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async (o) => window.confirm(o.title));
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(v: boolean) {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }

  const danger = opts?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => settle(false)} title={opts?.title || "确认"}>
        {opts ? (
          <div className="space-y-4">
            {opts.body ? <div className="text-sm text-neutral-700">{opts.body}</div> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                data-initial-focus={danger ? "" : undefined}
                onClick={() => settle(false)}
              >
                {opts.cancelLabel || "取消"}
              </button>
              <button
                type="button"
                className={danger ? "btn-danger" : "btn-primary"}
                data-initial-focus={danger ? undefined : ""}
                onClick={() => settle(true)}
              >
                {opts.confirmLabel || "确认"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}
