"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LayoutList, ListFilter, Columns3, Search, SlidersHorizontal, X } from "lucide-react";
import { LIST_GROUP_LABELS, LIST_PROP_LABELS, useListDisplay, type ListGroup, type ListProp } from "./listDisplay";

/** 功能区上的下拉按钮（筛选 ▾ / 显示 ▾）：点开为浮层面板，点外部或 Esc 关闭 */
export function HeadPopover({
  label,
  icon,
  caret = true,
  active = false,
  width = 280,
  iconOnly = false,
  glyph,
  children,
}: {
  /** 自定义按钮图标（替代 filter / display） */
  glyph?: React.ReactNode;
  iconOnly?: boolean;
  label: string;
  icon: "filter" | "display";
  caret?: boolean;
  active?: boolean;
  width?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const Icon = icon === "filter" ? ListFilter : SlidersHorizontal;
  return (
    <div className="nv-pop-wrap" ref={root}>
      <button
        type="button"
        className={iconOnly ? `icon-button nv-head-icon${active ? " is-active" : ""}` : `btn-secondary nv-head-btn${active ? " is-active" : ""}`}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {glyph ?? <Icon size={iconOnly ? 16 : 14} aria-hidden="true" />}
        {iconOnly ? null : label}
        {caret && !iconOnly ? <ChevronDown size={14} aria-hidden="true" className="nv-head-caret" /> : null}
      </button>
      {open ? (
        <div id={id} className="nv-pop" role="dialog" aria-label={label} style={{ width }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** 「显示」面板：分组方式 + 显示哪些属性。groups 为空时不显示分组（看板按列已分好） */
export function DisplayPanel({
  props = ["status", "priority", "owner", "due", "project"],
  groups,
}: {
  props?: ListProp[];
  groups?: ListGroup[];
}) {
  const [display, setDisplay] = useListDisplay();
  const groupOptions = groups ?? (["status", "priority", "owner", ...(props.includes("project") ? ["project" as const] : []), "none"] as ListGroup[]);
  // 当前页面不支持已存的分组方式（如项目内选了「按项目」）时，按状态显示
  const currentGroup = groupOptions.includes(display.group) ? display.group : "status";
  return (
    <div className="nv-display">
      {groupOptions.length ? (
        <>
          <div className="nv-pop-label">分组</div>
          <div className="nv-display-props" role="group" aria-label="分组方式">
            {groupOptions.map((g) => (
              <button
                key={g}
                type="button"
                className={`nv-chip-toggle${currentGroup === g ? " is-on" : ""}`}
                aria-pressed={currentGroup === g}
                onClick={() => setDisplay({ ...display, group: g })}
              >
                {g === "none" ? LIST_GROUP_LABELS[g] : `按${LIST_GROUP_LABELS[g]}`}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="nv-pop-label">显示属性</div>
      <div className="nv-display-props">
        {props.map((k) => (
          <button
            key={k}
            type="button"
            className={`nv-chip-toggle${display.props[k] ? " is-on" : ""}`}
            aria-pressed={display.props[k]}
            onClick={() => setDisplay({ ...display, props: { ...display.props, [k]: !display.props[k] } })}
          >
            {LIST_PROP_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 布局切换（列表 / 看板）：图标分段 */
export function LayoutToggle({ listHref, boardHref, current }: { listHref: string; boardHref: string; current: "list" | "board" }) {
  return (
    <div className="seg nv-layout-toggle" role="group" aria-label="布局">
      <Link href={listHref} aria-pressed={current === "list"} aria-label="列表" title="列表" className="seg-btn">
        <LayoutList size={14} aria-hidden="true" />
      </Link>
      <Link href={boardHref} aria-pressed={current === "board"} aria-label="看板" title="看板" className="seg-btn">
        <Columns3 size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

export type AppliedFilter = { field: string; value: string; removeHref: string };

/** 筛选条（高 40，只在有筛选条件时出现）：「字段 值 ×」+「清除全部」 */
export function AppliedFilters({ items, clearHref }: { items: AppliedFilter[]; clearHref: string }) {
  if (!items.length) return null;
  return (
    <div className="nv-applied" role="region" aria-label="已应用的筛选">
      {items.map((f) => (
        <span key={f.field} className="nv-filter-chip">
          <span className="nv-filter-field">{f.field}</span>
          <b>{f.value}</b>
          <Link href={f.removeHref} aria-label={`移除筛选：${f.field} ${f.value}`} className="nv-filter-x">
            <X size={12} aria-hidden="true" />
          </Link>
        </span>
      ))}
      <Link href={clearHref} className="nv-applied-clear">
        清除全部
      </Link>
    </div>
  );
}

/** 功能区里的搜索：默认是放大镜按钮，点开变成输入框（回车提交，保留其他参数） */
export function HeadSearch({ name = "q", value, placeholder, keep = {} }: { name?: string; value: string; placeholder: string; keep?: Record<string, string | undefined> }) {
  const [open, setOpen] = useState(Boolean(value));
  const [q, setQ] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  if (!open)
    return (
      <button type="button" className="icon-button nv-head-icon" aria-label={placeholder} title={placeholder} onClick={() => setOpen(true)}>
        <Search size={16} aria-hidden="true" />
      </button>
    );
  return (
    <form role="search" className="nv-head-search">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search size={14} aria-hidden="true" />
      <input
        ref={input}
        name={name}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => {
          if (!q) setOpen(false);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
      />
    </form>
  );
}
