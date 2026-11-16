"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, ListTodo, Search } from "lucide-react";

export type RefItem = { kind: "req" | "bug"; id: string; code: string; title: string; status: string };

/** 浮层的定位：贴着锚点矩形，放不下就翻到上方 */
export function usePopoverPosition(anchor: DOMRect | null, width: number, height: number) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left));
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPos({ top, left });
  }, [anchor, width, height]);
  return pos;
}

/** 点浮层外面或按 Esc 关闭 */
export function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref, onClose]);
}

/** 选择需求 / Bug（编辑器「关联需求」与「/」菜单共用） */
export function RefPicker({
  spaceId,
  anchor,
  onPick,
  onClose,
  title = "关联需求或 Bug",
}: {
  spaceId: string;
  anchor: DOMRect | null;
  onPick: (item: RefItem) => void;
  onClose: () => void;
  title?: string;
}) {
  const open = Boolean(anchor);
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<RefItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const pos = usePopoverPosition(anchor, 360, 340);
  useDismiss(open, box, onClose);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/docs/ref-search?spaceId=${encodeURIComponent(spaceId)}&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
        setActive(0);
      } catch {
        /* 取消或网络错误 */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [open, q, spaceId]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div ref={box} className="doc-popover doc-ref-picker" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={title}>
      <div className="doc-ref-search">
        <Search size={14} aria-hidden="true" />
        <input
          autoFocus
          className="doc-ref-input"
          placeholder="搜索本空间的需求或 Bug 标题、编号"
          value={q}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (items[active]) onPick(items[active]);
            }
          }}
        />
      </div>
      <ul id={listId} role="listbox" className="doc-menu-list">
        {items.map((it, i) => (
          <li
            key={`${it.kind}:${it.id}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`doc-menu-item${i === active ? " is-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
          >
            <span className="doc-menu-icon">
              {it.kind === "req" ? <ListTodo size={14} aria-hidden="true" /> : <Bug size={14} aria-hidden="true" />}
            </span>
            <span className="doc-menu-text">
              <span className="doc-menu-title">
                <span className="doc-ref-code">{it.code}</span> {it.title}
              </span>
              <span className="doc-menu-desc">{it.status}</span>
            </span>
          </li>
        ))}
        {!items.length ? (
          <li className="doc-menu-empty">{loading ? "搜索中…" : q ? "没有匹配的需求或 Bug" : "本空间还没有需求或 Bug"}</li>
        ) : null}
      </ul>
    </div>,
    document.body,
  );
}
