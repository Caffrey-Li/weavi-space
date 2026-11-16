"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import type { VisualIcon } from "@/components/ui/statusVisual";

export type StatusOption = { key: string; label: string; color: string; group?: string };

type Pos = { top?: number; bottom?: number; left?: number; right?: number; maxHeight: number };

/**
 * 「移动到…」菜单（M06 / M14）：拖拽的键盘与触屏等价路径。
 * 菜单渲染到 body 并按触发按钮定位，不会被表格/看板列的滚动容器裁掉；
 * 方向键在条目间移动，Enter 选择，Esc 关闭并把焦点还给触发按钮。
 */
export function StatusMenu({
  options,
  current,
  onSelect,
  disabled,
  trigger = "button",
  triggerLabel,
  ariaLabel,
  align = "right",
  visualOf,
}: {
  options: StatusOption[];
  current: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
  /** button：小号「移动」按钮；badge：带当前状态的可点胶囊 */
  trigger?: "button" | "badge" | "dots";
  triggerLabel?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  /** 提供时，badge 触发器与条目使用业务状态的图形 + 色调（如需求 10 态） */
  visualOf?: (key: string) => { tone: string; Icon: VisualIcon } | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const cur = options.find((o) => o.key === current);

  useLayoutEffect(() => {
    if (!open || !btn.current) {
      setPos(null);
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(340, options.length * 36 + 40);
    const next: Pos = { maxHeight: Math.max(160, Math.min(want, Math.max(below, above))) };
    if (below >= want || below >= above) next.top = r.bottom + 4;
    else next.bottom = vh - r.top + 4;
    if (align === "left") next.left = Math.max(8, Math.min(r.left, vw - 200));
    else next.right = Math.max(8, vw - r.right);
    setPos(next);
  }, [open, align, options.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    }
    function onScroll(e: Event) {
      if (menu.current && e.target instanceof Node && menu.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !pos) return;
    const first =
      menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]') ||
      menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    first?.focus({ preventScroll: true });
  }, [open, pos]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
      btn.current?.focus();
    }
  }

  let lastGroup: string | undefined;

  return (
    <div
      className="status-menu"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <button
        ref={btn}
        type="button"
        className={
          trigger === "badge"
            ? visualOf
              ? `status-badge is-trigger tone-${visualOf(current)?.tone || "neutral"}`
              : "status-trigger"
            : trigger === "dots"
              ? "icon-button board-dots"
              : "board-move-btn"
        }
        style={trigger === "badge" && cur && !visualOf ? ({ "--status-color": cur.color } as React.CSSProperties) : undefined}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel || (trigger === "badge" ? `状态：${cur?.label || current}，点击更改` : "移动到…")}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        {trigger === "badge" ? (
          <>
            {visualOf ? (
              (() => {
                const V = visualOf(current)?.Icon;
                return V ? <V size={14} aria-hidden="true" /> : null;
              })()
            ) : (
              <span className="status-dot" aria-hidden="true" />
            )}
            {cur?.label || current}
            <ChevronDown size={12} aria-hidden="true" className="status-chevron" />
          </>
        ) : trigger === "dots" ? (
          <MoreHorizontal size={16} aria-hidden="true" />
        ) : (
          triggerLabel || "移动"
        )}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              className="board-move-menu is-floating"
              role="menu"
              aria-label="移动到…"
              style={{ position: "fixed", ...pos }}
              onKeyDown={onMenuKey}
            >
              {options.map((o) => {
                const header = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.key}>
                    {header ? (
                      <div className="board-move-group" role="presentation">
                        {header}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={o.key === current}
                      className="board-move-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        btn.current?.focus();
                        if (o.key !== current) onSelect(o.key);
                      }}
                    >
                      {visualOf && visualOf(o.key) ? (
                        (() => {
                          const v = visualOf(o.key)!;
                          return <v.Icon size={14} aria-hidden="true" className={`menu-status-icon tone-${v.tone}`} />;
                        })()
                      ) : (
                        <span className="status-dot" style={{ background: o.color }} aria-hidden="true" />
                      )}
                      <span className="flex-1">{o.label}</span>
                      {o.key === current ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
