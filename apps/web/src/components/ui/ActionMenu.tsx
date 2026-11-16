"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

/** icon：前置 14px 图标（有任一项带图标时菜单改用 194 宽的图标样式）；divider：在该项之前加分隔线 */
export type ActionItem = { label: string; onSelect: () => void; tone?: "danger"; disabled?: boolean; icon?: LucideIcon; divider?: boolean };

/**
 * 行内「…」更多操作菜单：菜单 portal 到 body（不被表格裁切），
 * 方向键切换、Enter 选择、Esc 关闭并把焦点还给按钮。
 */
export function ActionMenu({ label, items }: { label: string; items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  // 菜单尺寸在渲染时算好，effect 只依赖数值（items 每次渲染都是新数组，不能直接做依赖）
  const menuWidth = items.some((it) => it.icon) ? 194 : 168;
  const menuHeight = items.length * 32 + items.filter((it) => it.divider).length * 9 + 12;
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, r.right - menuWidth));
    const below = r.bottom + 4;
    setPos({ top: below + menuHeight > window.innerHeight - 8 ? r.top - menuHeight - 4 : below, left });
  }, [open, menuWidth, menuHeight]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function onDown(e: MouseEvent) {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[next]?.focus();
      }
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-button board-dots"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menu}
              id={id}
              role="menu"
              className={`action-menu${items.some((it) => it.icon) ? " has-icons" : ""}`}
              style={{ top: pos.top, left: pos.left }}
            >
              {items.map((it) => (
                <Fragment key={it.label}>
                  {it.divider ? <div role="separator" className="action-menu-sep" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    className={`action-menu-item${it.tone === "danger" ? " is-danger" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      btn.current?.focus();
                      it.onSelect();
                    }}
                  >
                    {it.icon ? <it.icon size={14} aria-hidden="true" /> : null}
                    {it.label}
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
