"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { FloatingPop } from "./FloatingPop";

const WEEK_MON = ["一", "二", "三", "四", "五", "六", "日"];
const WEEK_SUN = ["日", "一", "二", "三", "四", "五", "六"];
/** 每周起始日来自「设置 · 常规」（AppShell 写在 <html data-week-start>），默认周一 */
const weekStartsSunday = () => typeof document !== "undefined" && document.documentElement.dataset.weekStart === "0";
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 「11月5日 周四」；不是今年时带年份 */
export function fmtPickerDate(s: string, withWeekday = true) {
  const d = fromIso(s);
  if (!d) return "";
  const y = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : "";
  return `${y}${d.getMonth() + 1}月${d.getDate()}日${withWeekday ? ` ${WEEKDAY[d.getDay()]}` : ""}`;
}

/**
 * 日期选择（Nova 风格，替换浏览器原生日期框）。
 * variant="input"：表单里的输入框样式；variant="pill"：新建需求弹窗里的属性胶囊。
 * 值为 YYYY-MM-DD 字符串，空串表示未设置。
 */
export function DatePicker({
  value,
  onChange,
  id,
  variant = "input",
  placeholder = "选择日期",
  ariaLabel,
  clearable = true,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  variant?: "input" | "pill";
  placeholder?: string;
  ariaLabel?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const [focus, setFocus] = useState<Date>(selected || today);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) setFocus(fromIso(value) || today);
  }, [open, value, today]);

  // 方向键移动后把焦点给到对应日期
  useEffect(() => {
    if (!open) return;
    // 浮层在下一帧才挂上，等它出现再给焦点
    const raf = requestAnimationFrame(() => {
      const el = grid.current?.querySelector<HTMLButtonElement>(`[data-day="${toIso(focus)}"]`);
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focus, open]);

  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const sunday = weekStartsSunday();
  const start = addDays(first, -(sunday ? first.getDay() : (first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  function pick(d: Date | null) {
    onChange(d ? toIso(d) : "");
    setOpen(false);
    anchor.current?.focus();
  }

  function onGridKey(e: React.KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      setFocus((f) => addDays(f, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setFocus((f) => new Date(f.getFullYear(), f.getMonth() + (e.key === "PageUp" ? -1 : 1), Math.min(f.getDate(), 28)));
    }
  }

  const quick: { label: string; date: Date }[] = [
    { label: "今天", date: today },
    { label: "明天", date: addDays(today, 1) },
    { label: "下周一", date: addDays(today, ((8 - today.getDay()) % 7) || 7) },
    { label: "月底", date: new Date(today.getFullYear(), today.getMonth() + 1, 0) },
  ];

  const text = value ? fmtPickerDate(value, variant === "input") : "";

  return (
    <>
      {variant === "pill" ? (
        <button
          ref={anchor}
          id={id}
          type="button"
          className={`nv-prop${value ? " is-set" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel ? `${ariaLabel}${text ? `：${text}` : ""}` : undefined}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <CalendarDays size={14} aria-hidden="true" />
          {text || placeholder}
        </button>
      ) : (
        <div className={`nv-date-field${open ? " is-open" : ""}`}>
          <button
            ref={anchor}
            id={id}
            type="button"
            className="input nv-date-input"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
          >
            <CalendarDays size={16} aria-hidden="true" className="nv-date-icon" />
            <span className={text ? "" : "nv-date-placeholder"}>{text || placeholder}</span>
          </button>
          {clearable && value && !disabled ? (
            <button type="button" className="nv-date-clear" aria-label="清除日期" onClick={() => onChange("")}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
      <FloatingPop anchorRef={anchor} open={open} onClose={close} width={280} className="nv-cal" role="dialog" label={ariaLabel || "选择日期"}>
        <div className="nv-cal-quick">
          {quick.map((q) => (
            <button key={q.label} type="button" className={sameDay(q.date, selected) ? "is-active" : ""} onClick={() => pick(q.date)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="nv-cal-head">
          <span className="nv-cal-title" aria-live="polite">
            {focus.getFullYear()}年{focus.getMonth() + 1}月
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="上个月"
            onClick={() => setFocus((f) => new Date(f.getFullYear(), f.getMonth() - 1, 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="下个月"
            onClick={() => setFocus((f) => new Date(f.getFullYear(), f.getMonth() + 1, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="nv-cal-week" aria-hidden="true">
          {(sunday ? WEEK_SUN : WEEK_MON).map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div ref={grid} className="nv-cal-grid" role="grid" onKeyDown={onGridKey}>
          {days.map((d) => {
            const out = d.getMonth() !== focus.getMonth();
            const sel = sameDay(d, selected);
            const isToday = sameDay(d, today);
            return (
              <button
                key={toIso(d)}
                type="button"
                role="gridcell"
                data-day={toIso(d)}
                tabIndex={sameDay(d, focus) ? 0 : -1}
                aria-selected={sel}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}`}
                className={`nv-cal-day${out ? " is-out" : ""}${sel ? " is-selected" : ""}${isToday ? " is-today" : ""}${
                  d.getDay() === 0 || d.getDay() === 6 ? " is-weekend" : ""
                }`}
                onClick={() => pick(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="nv-cal-foot">
          {clearable ? (
            <button type="button" className="nv-cal-link" onClick={() => pick(null)} disabled={!value}>
              清除
            </button>
          ) : (
            <span />
          )}
          <span className="nv-cal-hint">方向键选择 · Enter 确定</span>
        </div>
      </FloatingPop>
    </>
  );
}
