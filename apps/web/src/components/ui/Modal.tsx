"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { decideClose } from "./layerGuard";
import { inertProps } from "./inert";
import { focusInitial, lockScroll, trapTab, useOverlayPhase } from "./useOverlayPhase";

const ModalCloseContext = createContext<(() => void) | null>(null);

export function useModalClose() {
  return useContext(ModalCloseContext);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  dirty = false,
  busy = false,
  headLead,
  panelClassName,
}: {
  /** 标题前的内容（如新建需求弹窗的项目选择） */
  headLead?: React.ReactNode;
  /** 面板额外样式类 */
  panelClassName?: string;
  open: boolean;
  onClose: (reason?: "dismiss" | "discard") => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  dirty?: boolean;
  busy?: boolean;
}) {
  const titleId = useId();
  const guardTitleId = useId();
  const portalRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const guardRef = useRef<HTMLDivElement>(null);
  const guardReturn = useRef<HTMLElement | null>(null);
  const skipFocus = useRef(false);
  const [guard, setGuard] = useState<null | "busy" | "dirty">(null);
  const [mounted, setMounted] = useState(false);
  const { phase } = useOverlayPhase(open, {
    enterVar: "--clarity-duration-normal",
    exitVar: "--clarity-duration-fast",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setGuard(null);
      return;
    }
    const unlock = lockScroll();
    const portal = portalRef.current;
    const changed: HTMLElement[] = [];
    if (portal) {
      for (const el of Array.from(document.body.children)) {
        if (el !== portal && el instanceof HTMLElement && !el.hasAttribute("inert")) {
          el.setAttribute("inert", "");
          changed.push(el);
        }
      }
    }
    return () => {
      unlock();
      for (const el of changed) el.removeAttribute("inert");
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    focusInitial(guard ? guardRef.current : dialogRef.current);
  }, [open, guard]);

  function requestClose() {
    const decision = decideClose({ busy, dirty });
    if (decision === "close") {
      setGuard(null);
      onClose("dismiss");
      return;
    }
    const active = document.activeElement;
    guardReturn.current = active instanceof HTMLElement ? active : null;
    setGuard(decision === "confirm-busy" ? "busy" : "dirty");
  }

  function dismissGuard() {
    skipFocus.current = true;
    setGuard(null);
    const back = guardReturn.current;
    guardReturn.current = null;
    // 确认层关闭后主弹窗才解除 inert，焦点恢复要等这一帧渲染完成
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
      else focusInitial(dialogRef.current);
    });
  }

  function confirmGuard() {
    const reason = guard === "dirty" ? "discard" : "dismiss";
    setGuard(null);
    onClose(reason);
  }

  const guardState = useRef(guard);
  const dismissRef = useRef(dismissGuard);
  const requestRef = useRef(requestClose);
  guardState.current = guard;
  dismissRef.current = dismissGuard;
  requestRef.current = requestClose;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      const top = (guardState.current ? guardRef.current : dialogRef.current) ?? dialogRef.current;
      if (!top) return;
      if (event.key === "Tab") {
        trapTab(event, top);
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (guardState.current) {
        dismissRef.current();
        return;
      }
      if (event.target instanceof HTMLSelectElement) {
        event.target.blur();
        return;
      }
      requestRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!mounted || phase === "closed") return null;

  const guardCopy =
    guard === "busy"
      ? {
          title: "保存仍在进行",
          body: "关闭窗口不会取消已经发出的请求，结果以服务端为准。请勿再次提交同一次操作。",
          stay: "继续等待",
          leave: "仍然关闭",
        }
      : {
          title: "放弃未保存的更改？",
          body: "关闭后，这次填写的内容会被清除。",
          stay: "继续编辑",
          leave: "放弃更改",
        };

  return createPortal(
    <ModalCloseContext.Provider value={requestClose}>
      <div className="clarity-layer" data-clarity-layer="" ref={portalRef}>
        <div
          className="clarity-scrim"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (guard) dismissGuard();
            else requestClose();
          }}
        />
        <div
          ref={dialogRef}
          className={`modal-panel${wide ? " is-wide" : ""}${panelClassName ? ` ${panelClassName}` : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          aria-hidden={guard ? true : undefined}
          data-phase={phase}
          {...inertProps(Boolean(guard))}
        >
          <div className="modal-head">
            {headLead}
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            <button type="button" className="icon-button" aria-label="关闭" onClick={requestClose}>
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </div>
        {guard ? (
          <div
            ref={guardRef}
            className="modal-panel modal-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby={guardTitleId}
            data-phase="open"
          >
            <div className="modal-head">
              <h2 id={guardTitleId} className="modal-title">
                {guardCopy.title}
              </h2>
            </div>
            <div className="modal-body">
              <p className="field-hint">{guardCopy.body}</p>
              <div className="modal-form-actions">
                <button type="button" className="btn-primary" data-initial-focus="" onClick={dismissGuard}>
                  {guardCopy.stay}
                </button>
                <button
                  type="button"
                  className={guard === "dirty" ? "btn-danger" : "btn-secondary"}
                  onClick={confirmGuard}
                >
                  {guardCopy.leave}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ModalCloseContext.Provider>,
    document.body,
  );
}

/** 弹窗内的「取消」按钮：走与 Esc / 遮罩相同的关闭判断（有改动先确认）。 */
export function ModalCancelButton({ children = "取消", className = "btn-secondary" }: { children?: React.ReactNode; className?: string }) {
  const close = useModalClose();
  return (
    <button type="button" className={className} onClick={() => close?.()}>
      {children}
    </button>
  );
}
