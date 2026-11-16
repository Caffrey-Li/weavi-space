"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { AlertCircle, ArrowRight, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { BUG_BOARD_COLUMNS, BUG_STATUS_OPTIONS, bugStatusLabel } from "@/lib/constants";
import { BugStatusBadge, SeverityBadge, bugCode } from "@/components/ui/StatusBadge";
import { fmtShortDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { StatusDock, type DockStatus } from "./StatusDock";
import { StatusMenu } from "./StatusMenu";
import { useStatusMover, type MoveFailure } from "./useStatusMover";
import { DROP_ANIMATION, dockFirstCollision, resolveDropStatus } from "./collision";
import { BugEditModal } from "@/components/bugs/NewBugButton";
import type { BugFormValues } from "@/components/bugs/BugForm";

export type BugCard = {
  id: string;
  title: string;
  status: string;
  severity: string;
  boardOrder: number;
  /** 被退回次数（11-05） */
  reopenCount?: number;
  projectId?: string | null;
  projectName?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  requirementId?: string | null;
  requirementTitle?: string | null;
  summary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  projectIconUrl?: string | null;
  requirementCode?: string | null;
  assigneeAvatarUrl?: string | null;
  frontendId?: string | null;
  frontendName?: string | null;
  frontendAvatarUrl?: string | null;
  backendId?: string | null;
  backendName?: string | null;
  backendAvatarUrl?: string | null;
};

const COLUMNS = BUG_BOARD_COLUMNS;
const DOCK: DockStatus[] = BUG_STATUS_OPTIONS.map((s) => ({
  key: s.key,
  label: s.label,
  color: s.color,
  tone: s.key === "cancelled" ? "danger" : undefined,
}));

export function toBugForm(c: BugCard): BugFormValues & { id: string; ownerNames?: { frontend?: string | null; backend?: string | null } } {
  return {
    id: c.id,
    ownerNames: { frontend: c.frontendName, backend: c.backendName },
    title: c.title,
    summary: c.summary || "",
    projectId: c.projectId || "",
    requirementId: c.requirementId || "",
    severity: c.severity,
    frontendId: c.frontendId || "",
    backendId: c.backendId || "",
    status: c.status,
    // 扩展字段和富文本描述由编辑弹窗打开时向 /api/bugs/[id] 读取
    dueAt: "",
    environment: "",
    device: "",
    foundVersion: "",
    docUrl: "",
    productId: "",
    productNodeId: "",
  };
}

function CardBody({
  card,
  saving,
  failure,
  overlay,
  readOnly,
  onOpen,
  onMove,
  onRetry,
  onDismiss,
}: {
  card: BugCard;
  saving?: boolean;
  failure?: MoveFailure;
  overlay?: boolean;
  readOnly?: boolean;
  onOpen?: () => void;
  onMove?: (to: string) => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`board-card${overlay ? " is-overlay" : ""}${saving ? " is-saving" : ""}${
        failure && !failure.unknown ? " is-failed" : ""
      }`}
      aria-busy={saving || undefined}
    >
      <div className="board-card-top">
        <span className="board-card-code">{bugCode(card.id)}</span>
        {saving ? <span className="spinner board-card-spinner" aria-label="保存中" /> : null}
        <span className="board-card-menu">
          {onMove && !readOnly ? (
            <StatusMenu
              trigger="dots"
              options={BUG_STATUS_OPTIONS}
              current={card.status}
              disabled={saving}
              onSelect={onMove}
              ariaLabel={`移动 Bug「${card.title}」到…`}
            />
          ) : null}
        </span>
      </div>
      {onOpen ? (
        <button type="button" className="board-card-title text-left" title={card.title} onClick={onOpen}>
          {card.title}
        </button>
      ) : (
        <span className="board-card-title">{card.title}</span>
      )}
      <div className="board-card-meta">
        <SeverityBadge severity={card.severity} />
        {card.createdAt ? <span className="board-card-due" title="提交日期">{fmtShortDate(card.createdAt)}</span> : null}
        {card.frontendName || card.backendName ? (
          <span className="ml-auto nv-bug-owners" title={`前端：${card.frontendName || "未指派"} · 后端：${card.backendName || "未指派"}`}>
            {card.frontendName ? <Avatar name={card.frontendName} src={card.frontendAvatarUrl} size={22} /> : null}
            {card.backendName ? <Avatar name={card.backendName} src={card.backendAvatarUrl} size={22} /> : null}
          </span>
        ) : (
          <span className="ml-auto text-xs text-secondary">未指派</span>
        )}
      </div>
      {failure ? (
        <div className="board-card-error" role="alert">
          <AlertCircle size={12} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={failure.message}>
            {failure.unknown ? failure.message : `失败：${failure.message}`}
          </span>
          {!failure.unknown && onRetry ? (
            <button type="button" className="board-card-retry" onClick={onRetry}>
              <RotateCcw size={12} aria-hidden="true" />
              重试
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="board-card-retry" aria-label="关闭提示" onClick={onDismiss}>
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DraggableCard({ id, disabled, landed, children }: { id: string; disabled?: boolean; landed?: boolean; children: React.ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={`board-card-slot${isDragging ? " is-dragging" : ""}${disabled ? "" : " is-draggable"}${landed ? " is-landed" : ""}`}
    >
      {children}
    </div>
  );
}

function Column({
  id,
  label,
  count,
  listHref,
  dragFrom,
  children,
}: {
  id: string;
  label: string;
  count: number;
  listHref: string;
  dragFrom?: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isSource = dragFrom === id;
  const over = isOver && !isSource;
  return (
    <section
      ref={setNodeRef}
      className={`board-column${dragFrom != null ? " is-dragging-any" : ""}${isSource ? " is-source" : ""}${over ? " is-over" : ""}`}
      aria-label={`${label}，${count} 个`}
    >
      <header className="board-column-head">
        <BugStatusBadge status={id} />
        <span className="board-column-count">{count}</span>
        <Link href={listHref} className="icon-button board-dots" aria-label={`在列表查看「${label}」`} title="在列表查看">
          <MoreHorizontal size={16} aria-hidden="true" />
        </Link>
      </header>
      <div className="board-column-body">
        {over ? (
          <div className="board-drop-ghost" aria-hidden="true">
            放到「{label}」
          </div>
        ) : null}
        {children}
        {count === 0 && !over ? <p className="board-column-empty">拖到这里</p> : null}
      </div>
    </section>
  );
}

export function BugBoard({
  initialCards,
  canEdit = true,
  canDelete = false,
  listBase,
}: {
  initialCards: BugCard[];
  canEdit?: boolean;
  canDelete?: boolean;
  /** 列表视图地址（带当前筛选，已含 ?），列头「…」追加 status 跳转 */
  listBase: string;
}) {
  const listHref = (status: string) => `${listBase}&status=${encodeURIComponent(status)}`;
  const [cards, setCards] = useState(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<BugCard | null>(null);

  useEffect(() => setCards(initialCards), [initialCards]);

  const { move, saving, failed, dismiss } = useStatusMover<BugCard>({
    setItems: setCards,
    url: (id) => `/api/bugs/${id}/status`,
    labelOf: bugStatusLabel,
    noun: "Bug",
  });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const byStatus = useMemo(() => {
    const map: Record<string, BugCard[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const c of cards) if (map[c.status]) map[c.status].push(c);
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.boardOrder - b.boardOrder);
    return map;
  }, [cards]);

  const counts = useMemo(() => Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])), [byStatus]);
  const active = cards.find((c) => c.id === activeId) || null;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const card = cards.find((c) => c.id === String(e.active.id));
    if (!card || !e.over) return;
    const to = resolveDropStatus(e.over.id, COLUMNS.map((c) => c.key), (id) => cards.find((c) => c.id === id)?.status);
    if (to && to !== card.status) {
      void move(card, to);
      setLanded(card.id);
      window.setTimeout(() => setLanded((cur) => (cur === card.id ? null : cur)), 900);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext
        id="bug-board-dnd"
        sensors={sensors}
        collisionDetection={dockFirstCollision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          screenReaderInstructions: { draggable: "可用卡片上的「移动」按钮通过键盘更改状态。" },
          announcements: {
            onDragStart: () => "已拿起 Bug 卡片",
            onDragOver: ({ over }) => (over ? "可放入" : "未在可放置区域"),
            onDragEnd: ({ over }) => (over ? "已放下" : "已放回原处"),
            onDragCancel: () => "已取消拖动",
          },
        }}
      >
        <div className="board-columns">
          {COLUMNS.map((col) => (
            <Column key={col.key} id={col.key} label={col.label} listHref={listHref(col.key)} count={counts[col.key] || 0} dragFrom={active ? active.status : null}>
              {(byStatus[col.key] || []).map((c) => (
                <DraggableCard key={c.id} id={c.id} disabled={!canEdit || saving.has(c.id)} landed={landed === c.id}>
                  <CardBody
                    card={c}
                    saving={saving.has(c.id)}
                    failure={failed[c.id]}
                    readOnly={!canEdit}
                    onOpen={canEdit ? () => setEditing(c) : undefined}
                    onMove={(to) => void move(c, to)}
                    onRetry={() => failed[c.id] && void move(c, failed[c.id].to)}
                    onDismiss={() => dismiss(c.id)}
                  />
                </DraggableCard>
              ))}
            </Column>
          ))}
        </div>
        <p className="board-hint">
          <ArrowRight size={14} aria-hidden="true" />
          {canEdit
            ? `横向浏览全部 ${COLUMNS.length} 个状态；拖动卡片扔进底部状态抽屉即可改状态，点标题编辑。`
            : "当前账号没有编辑 Bug 的权限，仅可查看。"}
        </p>
        <StatusDock statuses={DOCK} counts={counts} activeStatus={active?.status ?? null} visible={!!active} />
        <DragOverlay dropAnimation={DROP_ANIMATION}>{active ? <CardBody card={active} overlay readOnly /> : null}</DragOverlay>
      </DndContext>
      <BugEditModal bug={editing ? toBugForm(editing) : null} canDelete={canDelete} onClose={() => setEditing(null)} />
    </div>
  );
}
