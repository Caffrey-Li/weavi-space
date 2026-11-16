"use client";

import { useCallback, useRef, useState } from "react";
import { FloatingPop } from "@/components/ui/FloatingPop";

/** 属性胶囊 / 属性值 + 下拉（浮层挂在 body 上，按屏幕空间上下翻，不会被容器裁掉） */
export function PropPicker({
  label,
  icon,
  active,
  disabled,
  title,
  ariaLabel,
  width = 200,
  className = "nv-prop",
  children,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  width?: number;
  /** 触发器样式：nv-prop（胶囊）或 rq-val（属性面板里的值） */
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="nv-prop-wrap">
      <button
        ref={anchor}
        type="button"
        className={`${className}${active ? " is-set" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>
      <FloatingPop anchorRef={anchor} open={open} onClose={close} width={width} className="nv-prop-pop" role="listbox">
        {children(close)}
      </FloatingPop>
    </div>
  );
}
