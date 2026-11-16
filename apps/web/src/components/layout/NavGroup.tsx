"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/** 侧栏分组（Section Header + 可折叠列表），折叠状态记在 localStorage */
export function readOpen(key: string, fallback: boolean) {
  try {
    const v = window.localStorage.getItem(`pm-nav-group:${key}`);
    return v == null ? fallback : v !== "closed";
  } catch {
    return fallback;
  }
}
export function saveOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(`pm-nav-group:${key}`, open ? "open" : "closed");
  } catch {
    /* 存储不可用时只在本次会话生效 */
  }
}

export function NavGroup({
  id,
  label,
  action,
  children,
}: {
  id: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  useEffect(() => setOpen(readOpen(id, true)), [id]);
  return (
    <div className="nv-nav-group">
      <div className="nv-nav-group-head">
        <button
          type="button"
          className="nv-nav-group-label"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() =>
            setOpen((v) => {
              saveOpen(id, !v);
              return !v;
            })
          }
        >
          {label}
          <ChevronDown size={12} aria-hidden="true" className="nv-caret" />
        </button>
        {action}
      </div>
      <div id={listId} hidden={!open} className="nv-nav-list">
        {children}
      </div>
    </div>
  );
}

