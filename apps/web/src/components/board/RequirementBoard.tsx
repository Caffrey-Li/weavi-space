"use client";

import { useHiddenStatuses, useReqBoardColumns, useReqStatusOptions, useStatusOptionsFor } from "@/components/requirements/ReqStagesContext";
import { remapHiddenStatus } from "@/lib/req-stages-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertCircle, CheckSquare, Filter, Minus, Plus, RotateCcw, Search, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  REQ_STATUS_OPTIONS,
  normalizeReqStatus,
  reqStatusLabel,
} from "@/lib/constants";
import { DuePill, OwnerPill, PriorityPill, TagPill } from "@/components/ui/Pills";
import { REQ_STATUS_VISUAL } from "@/components/ui/statusVisual";
import { projectTone } from "@/lib/project-tone";
import { NewRequirementButton } from "@/components/requirements/NewRequirementButton";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { DisplayPanel, HeadPopover, LayoutToggle } from "@/components/views/HeadControls";
import { useListDisplay } from "@/components/views/listDisplay";
import { StatusDock, type DockStatus } from "./StatusDock";
import { StatusMenu } from "./StatusMenu";
import { useStatusMover, type MoveFailure } from "./useStatusMover";
import { DROP_ANIMATION, dockFirstCollision, resolveDropStatus } from "./collision";

export type BoardCard = {
  id: string;
  title: string;
  status: string;
  priority: string;
  boardOrder: number;
  projectName?: string | null;
  assignees: string[];
  assigneeIds?: string[];
  projectId?: string | null;
  code?: string | null;
  plannedEndAt?: string | null;
};

const toDock = (list: typeof REQ_STATUS_OPTIONS): DockStatus[] =>
  list.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    tone: s.key === "cancelled" ? "danger" : undefined,
  }));

function CardBody({
  card,
  saving,
  failure,
  overlay,
  onMove,
  onRetry,
  onDismiss,
  readOnly,
  stackCount,
  showProject = false,
}: {
  showProject?: boolean;
  card: BoardCard;
  saving?: boolean;
  failure?: MoveFailure;
  overlay?: boolean;
  onMove?: (status: string) => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  readOnly?: boolean;
  /** 拖动多张卡片时在浮层上显示数量 */
  stackCount?: number;
}) {
  const statusOptions = useStatusOptionsFor()(card.projectId);
  const [display] = useListDisplay();
  const show = display.props;
  return (
    <div
      className={`board-card${overlay ? " is-overlay" : ""}${saving ? " is-saving" : ""}${
        failure && !failure.unknown ? " is-failed" : ""
      }${stackCount && stackCount > 1 ? " is-stack" : ""}`}
      aria-busy={saving || undefined}
    >
      {stackCount && stackCount > 1 ? (
        <span className="board-card-stack-count" aria-label={`共 ${stackCount} 条`}>
          {stackCount}
        </span>
      ) : null}
      <div className="board-card-top">
        <span className="board-card-code">{card.code}</span>
        {saving ? <span className="spinner board-card-spinner" aria-label="保存中" /> : null}
        <span className="board-card-menu">
          {onMove && !readOnly ? (
            <StatusMenu
              trigger="dots"
              options={statusOptions}
              current={normalizeReqStatus(card.status)}
              disabled={saving}
              onSelect={onMove}
              ariaLabel={`移动「${card.title}」到…`}
              visualOf={(k) => REQ_STATUS_VISUAL[k]}
            />
          ) : null}
        </span>
      </div>
      <Link
        href={`/requirements/${card.id}`}
        className="board-card-title"
        title={card.title}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      >
        {card.title}
      </Link>
      <div className="board-card-props">
        {show.priority ? <PriorityPill priority={card.priority} /> : null}
        {show.owner ? <OwnerPill owners={card.assignees.map((name) => ({ name }))} /> : null}
        {show.due ? <DuePill date={card.plannedEndAt} done={card.status === "online"} /> : null}
        {showProject && show.project && card.projectName ? (
          <TagPill label={card.projectName} color={projectTone(card.projectName)} />
        ) : null}
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

function DraggableCard({
  card,
  disabled,
  selected,
  groupDragging,
  landed,
  onToggleSelect,
  children,
}: {
  card: BoardCard;
  /** 刚放进新列：播放落位动画 */
  landed?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** 作为多选的一员被一起拖走 */
  groupDragging?: boolean;
  onToggleSelect?: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-card-id={card.id}
      aria-selected={onToggleSelect ? !!selected : undefined}
      onClickCapture={(e) => {
        // ⌘/Ctrl/Shift + 点击：加入或移出多选，不打开详情
        if (!onToggleSelect || !(e.metaKey || e.ctrlKey || e.shiftKey)) return;
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect();
      }}
      className={`board-card-slot${isDragging || groupDragging ? " is-dragging" : ""}${disabled ? "" : " is-draggable"}${
        selected ? " is-selected" : ""
      }${landed ? " is-landed" : ""}`}
    >
      {children}
    </div>
  );
}

function Column({
  id,
  label,
  count,
  children,
  flash,
  collapsed,
  onToggle,
  create,
  dragFrom,
  onSelectAll,
}: {
  /** 列头「全选此列」 */
  onSelectAll?: () => void;
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
  flash?: boolean;
  /** 正在拖动的卡片原所在列（null 表示没有在拖） */
  dragFrom?: string | null;
  collapsed: boolean;
  onToggle: () => void;
  create?: { defaultProjectId?: string; lockProject?: boolean };
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const V = REQ_STATUS_VISUAL[id];
  if (collapsed)
    return (
      <section ref={setNodeRef} className={`board-column is-collapsed${isOver ? " is-over" : ""}`} aria-label={`${label}，${count} 条（已收起）`}>
        <button type="button" className="board-column-expand" onClick={onToggle} aria-label={`展开「${label}」列`} title="展开列">
          {V ? <V.Icon size={14} aria-hidden="true" /> : null}
          <span className="board-column-vlabel">{label}</span>
          <span className="board-column-count">{count}</span>
        </button>
      </section>
    );
  const dragging = dragFrom != null;
  const isSource = dragFrom === id;
  const state = `${dragging ? " is-dragging-any" : ""}${isSource ? " is-source" : ""}${isOver && !isSource ? " is-over" : ""}`;
  return (
    <section ref={setNodeRef} className={`board-column${state}${flash ? " is-flash" : ""}`} aria-label={`${label}，${count} 条`}>
      <header className="board-column-head">
        {V ? <V.Icon size={14} aria-hidden="true" /> : null}
        <span className="board-column-name">{label}</span>
        <span className="board-column-count">{count}</span>
        <span className="flex-1" />
        {onSelectAll && count ? (
          <button type="button" className="icon-button board-col-act" onClick={onSelectAll} aria-label={`全选「${label}」列的 ${count} 条需求`} title="全选此列">
            <CheckSquare size={15} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="icon-button board-col-act" onClick={onToggle} aria-label={`收起「${label}」列`} title="收起列">
          <Minus size={16} aria-hidden="true" />
        </button>
        {create ? (
          <NewRequirementButton {...create} fullPage={false} iconOnly label="新建需求" className="icon-button board-col-act" />
        ) : null}
      </header>
      <div className="board-column-body">
        {isOver && !isSource ? (
          <div className="board-drop-ghost" aria-hidden="true">
            放到「{label}」
          </div>
        ) : null}
        {children}
        {count === 0 && !(isOver && !isSource) ? <p className="board-column-empty">拖到这里</p> : null}
        {create ? (
          <NewRequirementButton {...create} fullPage={false} label="新建需求" icon={<Plus size={14} aria-hidden="true" />} className="board-column-new" />
        ) : null}
      </div>
    </section>
  );
}

export function RequirementBoard({
  initialCards,
  currentUserId,
  canMove = true,
  projects = [],
  projectId = "",
  crumbs,
  canCreate = false,
}: {
  crumbs: WorkCrumb[];
  canCreate?: boolean;
  initialCards: BoardCard[];
  currentUserId?: string;
  canMove?: boolean;
  projects?: { id: string; name: string }[];
  /** 空 = 全部项目 */
  projectId?: string;
}) {
  const router = useRouter();
  // 启用中的阶段（Figma 52）：看板列、状态抽屉、批量移动菜单
  const COLUMNS = useReqBoardColumns(projectId);
  const hiddenStatuses = useHiddenStatuses(projectId);
  const statusOptions = useReqStatusOptions(projectId);
  const DOCK = useMemo(() => toDock(statusOptions), [statusOptions]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [owner, setOwner] = useState("");
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(() => new Set());
  const toggleCol = (k: string) =>
    setCollapsedCols((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const create = canCreate ? { defaultProjectId: projectId || undefined, lockProject: Boolean(projectId) } : undefined;
  const normalize = (list: BoardCard[]) => list.map((c) => ({ ...c, status: normalizeReqStatus(c.status) }));
  const [cards, setCards] = useState(() => normalize(initialCards));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flashCol, setFlashCol] = useState<string | null>(null);
  const [landed, setLanded] = useState<Set<string>>(new Set());
  function markLanded(ids: string[]) {
    setLanded(new Set(ids));
    window.setTimeout(() => setLanded((cur) => (ids.some((i) => cur.has(i)) ? new Set() : cur)), 900);
  }
  // 多选：在看板空白处按住鼠标拖出选框，或 ⌘/Ctrl/Shift + 点击卡片
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    setCards(normalize(initialCards));
  }, [initialCards]);

  const { move, saving, failed, dismiss } = useStatusMover<BoardCard>({
    setItems: setCards,
    url: (id) => `/api/requirements/${id}/status`,
    labelOf: reqStatusLabel,
  });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cards) (c.assigneeIds || []).forEach((id, i) => map.set(id, c.assignees[i] || id));
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [cards]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const who = owner === "__me__" ? currentUserId : owner;
    return cards.filter(
      (c) =>
        (!q || c.title.toLowerCase().includes(q) || (c.code || "").toLowerCase().includes(q)) &&
        (!who || c.assigneeIds?.includes(who)),
    );
  }, [cards, query, owner, currentUserId]);

  const shownColumns = statusFilter ? COLUMNS.filter((c) => c.key === statusFilter) : COLUMNS;

  const byStatus = useMemo(() => {
    const map: Record<string, BoardCard[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const c of visible) {
      if (c.status === "cancelled") continue;
      // 停用阶段里残留的需求（如外部同步写入）显示在它之后第一个启用的阶段列
      (map[c.status] || map[remapHiddenStatus(c.status, hiddenStatuses)] || map["req_in_progress"]).push(c);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.boardOrder - b.boardOrder);
    return map;
  }, [visible, COLUMNS, hiddenStatuses]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(byStatus)) out[k] = byStatus[k].length;
    return out;
  }, [byStatus]);

  const activeCard = cards.find((c) => c.id === activeId) || null;

  // 只认当前可见、未在保存中的已选卡片
  const selectedVisible = useMemo(
    () => visible.filter((c) => selected.has(c.id) && c.status !== "cancelled" && !saving.has(c.id)),
    [visible, selected, saving],
  );
  const groupIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    if (selected.has(activeId) && selectedVisible.length > 1) return new Set(selectedVisible.map((c) => c.id));
    return new Set([activeId]);
  }, [activeId, selected, selectedVisible]);

  const clearSelection = useCallback(() => setSelected((s) => (s.size ? new Set() : s)), []);
  const toggleSelect = useCallback(
    (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  useEffect(() => {
    if (!selected.size || activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, activeId, clearSelection]);

  /**
   * 在看板空白处按下鼠标开始框选。指针靠近看板上下 / 左右边缘时自动滚动（列内纵向、看板横向），
   * 选框锚点跟随内容移动，所以可以一次框选超过一屏的卡片。
   */
  function onMarqueeStart(e: React.MouseEvent<HTMLDivElement>) {
    if (!canMove || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".board-card-slot, a, button, select, input, textarea, [role='menu']")) return;
    const root = columnsRef.current;
    if (!root) return;
    e.preventDefault(); // 阻止拖出文字选区
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const sx = e.clientX;
    const sy = e.clientY;
    const startLeft = root.scrollLeft;
    const bodies = Array.from(root.querySelectorAll<HTMLElement>(".board-column-body"));
    const startTops = new Map(bodies.map((b) => [b, b.scrollTop]));
    let px = sx;
    let py = sy;
    let moved = false;
    let raf = 0;
    const EDGE = 48;
    const MAX = 22;

    function update() {
      // 统一换算到「开始框选时」的滚动位置下比较：锚点不动，指针和卡片都加上之后滚过的距离
      const dx = root!.scrollLeft - startLeft;
      let dy = 0;
      for (const b of bodies) {
        const d = b.scrollTop - (startTops.get(b) || 0);
        if (Math.abs(d) > Math.abs(dy)) dy = d;
      }
      const left = Math.min(sx, px + dx);
      const right = Math.max(sx, px + dx);
      const top = Math.min(sy, py + dy);
      const bottom = Math.max(sy, py + dy);
      // 显示的选框：换回当前视口位置，并限制在看板可见区域内
      const box = root!.getBoundingClientRect();
      const vl = Math.max(left - dx, box.left);
      const vt = Math.max(top - dy, box.top);
      const vr = Math.min(right - dx, box.right);
      const vb = Math.min(bottom - dy, box.bottom);
      setMarquee({ left: vl, top: vt, width: Math.max(0, vr - vl), height: Math.max(0, vb - vt) });
      const next = new Set(base);
      root!.querySelectorAll<HTMLElement>("[data-card-id]").forEach((n) => {
        const col = n.closest<HTMLElement>(".board-column-body");
        const own = col ? col.scrollTop - (startTops.get(col) || 0) : 0;
        const r = n.getBoundingClientRect();
        const cl = r.left + dx;
        const cr = r.right + dx;
        const ct = r.top + own;
        const cb = r.bottom + own;
        if (cr >= left && cl <= right && cb >= top && ct <= bottom) next.add(n.dataset.cardId!);
      });
      setSelected(next);
    }

    function tick() {
      raf = 0;
      if (!moved) return;
      const box = root!.getBoundingClientRect();
      const speed = (d: number) => Math.min(MAX, Math.ceil(((EDGE - d) / EDGE) * MAX));
      let vy = 0;
      let vx = 0;
      if (py > box.bottom - EDGE) vy = speed(box.bottom - py);
      else if (py < box.top + EDGE) vy = -speed(py - box.top);
      if (px > box.right - EDGE) vx = speed(box.right - px);
      else if (px < box.left + EDGE) vx = -speed(px - box.left);
      let scrolled = false;
      if (vx) {
        const before = root!.scrollLeft;
        root!.scrollLeft += vx;
        scrolled ||= root!.scrollLeft !== before;
      }
      if (vy) {
        // 只滚选框横向覆盖到的列
        const ax = sx - (root!.scrollLeft - startLeft);
        const l = Math.min(ax, px);
        const r = Math.max(ax, px);
        for (const b of bodies) {
          const rb = b.getBoundingClientRect();
          if (rb.right < l || rb.left > r) continue;
          const before = b.scrollTop;
          b.scrollTop += vy;
          scrolled ||= b.scrollTop !== before;
        }
      }
      if (scrolled) update();
      if (vx || vy) raf = window.setTimeout(tick, 16);
    }

    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      moved = true;
      px = ev.clientX;
      py = ev.clientY;
      update();
      if (!raf) raf = window.setTimeout(tick, 16);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) window.clearTimeout(raf);
      setMarquee(null);
      if (!moved && !additive) clearSelection();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** 全选：当前筛选下所有未取消的卡片；传列 key 时只选这一列 */
  const selectAll = useCallback(
    (col?: string) => {
      const list = visible.filter((c) => c.status !== "cancelled" && (!col || (byStatus[col] || []).some((x) => x.id === c.id)));
      setSelected((prev) => {
        const n = new Set(col ? prev : []);
        list.forEach((c) => n.add(c.id));
        return n;
      });
    },
    [visible, byStatus],
  );

  // ⌘/Ctrl + A：全选看板上的卡片（焦点在输入框里时不拦截）
  useEffect(() => {
    if (!canMove) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a" || activeId) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector("[role='dialog']")) return;
      e.preventDefault();
      selectAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canMove, activeId, selectAll]);

  async function moveMany(list: BoardCard[], to: string) {
    const targets = list.filter((c) => c.status !== to);
    setSelected(new Set());
    if (!targets.length) return;
    if (targets.length === 1) return moveTo(targets[0], to);
    const results = await Promise.all(targets.map((c) => move(c, to, { silent: true })));
    const done = targets.filter((_, i) => results[i]);
    if (!done.length) return;
    markLanded(done.map((c) => c.id));
    if (to !== "cancelled") {
      setFlashCol(to);
      window.setTimeout(() => setFlashCol((c) => (c === to ? null : c)), 1000);
    }
    const failedCount = targets.length - done.length;
    toast.show({
      tone: "success",
      message: `${done.length} 条需求已放入「${reqStatusLabel(to)}」${failedCount ? `，${failedCount} 条未成功` : ""}`,
      action: {
        label: "撤销",
        onClick: () => {
          void Promise.all(done.map((c) => move({ ...c, status: to }, c.status, { silent: true }))).then((rs) => {
            const n = rs.filter(Boolean).length;
            if (n) toast.success(`已撤销，${n} 条需求回到原状态`);
          });
        },
      },
    });
  }

  async function moveTo(card: BoardCard, to: string) {
    const ok = await move(card, to);
    if (ok) markLanded([card.id]);
    if (ok && to !== "cancelled") {
      setFlashCol(to);
      window.setTimeout(() => setFlashCol((c) => (c === to ? null : c)), 1000);
    }
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    // 拖一张未选中的卡片：只拖它，原有多选作废（同访达）
    if (!selected.has(id)) clearSelection();
    setActiveId(id);
  }

  function onDragEnd(e: DragEndEvent) {
    const group = cards.filter((c) => groupIds.has(c.id));
    setActiveId(null);
    const card = cards.find((c) => c.id === String(e.active.id));
    if (!card || !e.over) return;
    const to = resolveDropStatus(e.over.id, COLUMNS.map((c) => c.key), (id) => cards.find((c) => c.id === id)?.status);
    if (!to) return;
    if (group.length > 1) void moveMany(group, to);
    else if (to !== card.status) void moveTo(card, to);
  }

  return (
    <div className="nv-board-wrap">
      <WorkHeader
        crumbs={crumbs}
        count={visible.filter((c) => c.status !== "cancelled").length}
        actions={
          <>
            {projectId ? (
              <LayoutToggle listHref={`/projects/${projectId}/requirements`} boardHref={`/projects/${projectId}/board`} current="board" />
            ) : null}
            <HeadPopover label="筛选" icon="filter" active={Boolean(query || statusFilter || owner)}>
              <div className="req-filters" role="search" aria-label="筛选看板">
                <div className="search-field">
                  <Search size={16} aria-hidden="true" className="search-field-icon" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索需求标题或编号"
                    aria-label="搜索需求标题或编号"
                    className="input search-field-input"
                  />
                  {query ? (
                    <button type="button" className="search-field-clear" aria-label="清除搜索" onClick={() => setQuery("")}>
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
                <label className="select-field">
                  <Filter size={14} aria-hidden="true" className="select-field-icon" />
                  <span className="sr-only">项目</span>
                  <select
                    className="input select-field-input"
                    value={projectId}
                    onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}/board` : "/board")}
                  >
                    <option value="">全部项目</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-field">
                  <Filter size={14} aria-hidden="true" className="select-field-icon" />
                  <span className="sr-only">状态</span>
                  <select className="input select-field-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">全部状态</option>
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-field">
                  <Filter size={14} aria-hidden="true" className="select-field-icon" />
                  <span className="sr-only">负责人</span>
                  <select className="input select-field-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">全部负责人</option>
                    {currentUserId ? <option value="__me__">我负责的</option> : null}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {query || statusFilter || owner ? (
                  <button
                    type="button"
                    className="btn-ghost req-clear"
                    onClick={() => {
                      setQuery("");
                      setStatusFilter("");
                      setOwner("");
                    }}
                  >
                    清除筛选
                  </button>
                ) : null}
              </div>
            </HeadPopover>
            <HeadPopover label="显示" icon="display">
              <DisplayPanel groups={[]} props={projectId ? ["priority", "owner", "due"] : ["priority", "owner", "due", "project"]} />
            </HeadPopover>
            {canCreate ? (
              <NewRequirementButton defaultProjectId={projectId || undefined} lockProject={Boolean(projectId)} icon={null} className="btn-primary nv-head-btn" />
            ) : null}
          </>
        }
      />
      <div className="board-main">
      <DndContext
        id="req-board-dnd"
        sensors={sensors}
        collisionDetection={dockFirstCollision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          screenReaderInstructions: { draggable: "可用卡片上的「移动」按钮通过键盘更改状态。" },
          announcements: {
            onDragStart: () => "已拿起需求卡片",
            onDragOver: ({ over }) => (over ? "可放入" : "未在可放置区域"),
            onDragEnd: ({ over }) => (over ? "已放下" : "已放回原处"),
            onDragCancel: () => "已取消拖动",
          },
        }}
      >
        <div
          ref={columnsRef}
          className={`board-columns${marquee ? " is-marqueeing" : ""}`}
          onMouseDown={onMarqueeStart}
        >
          {shownColumns.map((col) => (
            <Column
              key={col.key}
              id={col.key}
              label={col.label}
              count={counts[col.key] || 0}
              flash={flashCol === col.key}
              collapsed={collapsedCols.has(col.key)}
              onToggle={() => toggleCol(col.key)}
              create={create}
              dragFrom={activeCard ? activeCard.status : null}
              onSelectAll={canMove ? () => selectAll(col.key) : undefined}
            >
              {(byStatus[col.key] || []).map((c) => (
                <DraggableCard
                  key={c.id}
                  card={c}
                  disabled={!canMove || saving.has(c.id)}
                  selected={selected.has(c.id)}
                  groupDragging={groupIds.size > 1 && groupIds.has(c.id)}
                  landed={landed.has(c.id)}
                  onToggleSelect={canMove ? () => toggleSelect(c.id) : undefined}
                >
                  <CardBody
                    card={c}
                    saving={saving.has(c.id)}
                    failure={failed[c.id]}
                    readOnly={!canMove}
                    onMove={(to) => void moveTo(c, to)}
                    onRetry={() => failed[c.id] && void moveTo(c, failed[c.id].to)}
                    onDismiss={() => dismiss(c.id)}
                    showProject={!projectId}
                  />
                </DraggableCard>
              ))}
            </Column>
          ))}
        </div>
        {marquee ? <div className="board-marquee" style={marquee} aria-hidden="true" /> : null}
        {selectedVisible.length ? (
          <div className="board-selection-bar" role="status">
            <CheckSquare size={16} aria-hidden="true" />
            <span>
              已选 <strong>{selectedVisible.length}</strong> 条，拖动其中任意一张即可一起扔进状态抽屉
            </span>
            {selectedVisible.length < visible.filter((c) => c.status !== "cancelled").length ? (
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => selectAll()}>
                全选 {visible.filter((c) => c.status !== "cancelled").length}
              </button>
            ) : null}
            <StatusMenu
              options={statusOptions}
              current=""
              onSelect={(to) => void moveMany(selectedVisible, to)}
              triggerLabel="批量移动到…"
              ariaLabel={`把已选的 ${selectedVisible.length} 条需求移动到…`}
            />
            <button type="button" className="link-button" onClick={clearSelection}>
              取消选择
            </button>
          </div>
        ) : null}
        <StatusDock
          statuses={DOCK}
          counts={counts}
          activeStatus={groupIds.size > 1 ? null : activeCard?.status ?? null}
          visible={!!activeCard}
          title={groupIds.size > 1 ? `把 ${groupIds.size} 条需求扔进状态抽屉` : "扔进状态抽屉"}
        />
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeCard ? <CardBody card={activeCard} overlay readOnly stackCount={groupIds.size} showProject={!projectId} /> : null}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}
