"use client";

import { useDroppable } from "@dnd-kit/core";
import { ArrowDownToLine, Inbox } from "lucide-react";

export type DockStatus = { key: string; label: string; color: string; tone?: "danger" };

export const DOCK_PREFIX = "dock:";

export function dockId(status: string) {
  return `${DOCK_PREFIX}${status}`;
}

export function statusFromDropId(id: string | number | null | undefined): string | null {
  const s = String(id ?? "");
  return s.startsWith(DOCK_PREFIX) ? s.slice(DOCK_PREFIX.length) : null;
}

function Bin({
  status,
  count,
  current,
}: {
  status: DockStatus;
  count?: number;
  current: boolean;
}) {
  // 当前状态的口子也可放：放回去等于取消，不会因为禁用而落到相邻口子
  const { setNodeRef, isOver } = useDroppable({ id: dockId(status.key) });
  const Icon = isOver ? ArrowDownToLine : Inbox;
  return (
    <div
      ref={setNodeRef}
      className={`dock-bin${isOver ? " is-over" : ""}${current ? " is-current" : ""}${
        status.tone === "danger" ? " is-danger" : ""
      }`}
      style={{ "--bin-color": status.color } as React.CSSProperties}
      aria-label={current ? `${status.label}（当前状态）` : `放入「${status.label}」`}
    >
      <span className="dock-bin-lid" aria-hidden="true" />
      <Icon size={22} aria-hidden="true" className="dock-bin-icon" />
      <span className="dock-bin-label">{status.label}</span>
      <span className="dock-bin-meta">{current ? (isOver ? "松手取消" : "当前") : isOver ? "松手放入" : count != null ? count : ""}</span>
    </div>
  );
}

/**
 * 状态抽屉：拿起一张卡片/一行时从底部出现，所有状态一字排开，
 * 把条目「扔」进任意一个口子就完成改状态，不用横向滚动去找列。
 */
export function StatusDock({
  statuses,
  counts,
  activeStatus,
  visible,
  title = "扔进状态抽屉",
  hint = "松手即更新状态 · 拖回原处或按 Esc 取消",
}: {
  statuses: DockStatus[];
  counts?: Record<string, number>;
  activeStatus: string | null;
  visible: boolean;
  title?: string;
  hint?: string;
}) {
  return (
    <div className="status-dock" data-visible={visible ? "true" : "false"} aria-hidden={visible ? undefined : true}>
      <div className="status-dock-head">
        <span className="status-dock-title">{title}</span>
        <span className="status-dock-hint">{hint}</span>
      </div>
      <div className="status-dock-bins" style={{ "--bin-count": statuses.length } as React.CSSProperties}>
        {statuses.map((s) => (
          <Bin key={s.key} status={s} count={counts?.[s.key]} current={activeStatus === s.key} />
        ))}
      </div>
    </div>
  );
}
