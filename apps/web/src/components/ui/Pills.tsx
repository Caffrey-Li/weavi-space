"use client";

import { differenceInCalendarDays } from "date-fns";
import { CalendarDays } from "lucide-react";
import { PRIORITY_LABELS, normalizePriority } from "@/lib/constants";
import { fmtDate, fmtMonthDay } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { PriorityGlyph } from "./Glyphs";

/**
 * Plane 式属性胶囊（DESIGN-SPEC §5.3 Property）：高 24、圆角 sm、1px border/default、12 号字。
 * 列表行与看板卡片的属性都用它。
 */
export function PriorityPill({ priority }: { priority: string }) {
  const key = normalizePriority(priority);
  const label = PRIORITY_LABELS[key]?.label || key;
  return (
    <span className="pp sq" title={`优先级：${label}`}>
      <PriorityGlyph priority={key} />
      <span className="sr-only">优先级 {label}</span>
    </span>
  );
}

export function OwnerPill({ owners }: { owners: { name: string; avatarUrl?: string | null }[] }) {
  const lead = owners[0];
  if (!lead) return <span className="pp is-muted">未指派</span>;
  return (
    <span className="pp" title={owners.map((o) => o.name).join("、")}>
      <Avatar name={lead.name} src={lead.avatarUrl} size={16} />
      {lead.name}
      {owners.length > 1 ? <span className="pp-more">+{owners.length - 1}</span> : null}
    </span>
  );
}

/** 截止日期：剩 3 天以内 warning，过期 danger 并显示「逾期 N 天」；已完成的不提示 */
export function DuePill({ date, done = false }: { date: string | Date | null | undefined; done?: boolean }) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const diff = differenceInCalendarDays(d, new Date());
  const over = !done && diff < 0;
  const warn = !done && diff >= 0 && diff <= 3;
  return (
    // 「逾期 N 天」按当天算：服务器和浏览器时区不同、或跨零点时两边会差一天，水合时以服务器渲染的为准
    <span suppressHydrationWarning className={`pp due${over ? " is-over" : warn ? " is-warn" : ""}`} title={`计划完成 ${fmtDate(d)}`}>
      <CalendarDays size={14} aria-hidden="true" />
      {over ? `逾期 ${-diff} 天` : fmtMonthDay(d)}
    </span>
  );
}

export function TagPill({ label, color, href }: { label: string; color?: string; href?: string }) {
  const body = (
    <>
      <i style={{ background: color || "var(--nv-text-tertiary)" }} aria-hidden="true" />
      {label}
    </>
  );
  return href ? (
    <a href={href} className="pp is-link" onClick={(e) => e.stopPropagation()}>
      {body}
    </a>
  ) : (
    <span className="pp">{body}</span>
  );
}

/** 数量胶囊：高 16、micro 字号 */
export function CountPill({ n, className = "" }: { n: number | string; className?: string }) {
  return <span className={`nv-count ${className}`}>{n}</span>;
}
