"use client";

import { useReqStatusOptions, useStatusOptionsFor } from "./ReqStagesContext";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertCircle, Archive, Bug, ChevronDown, ExternalLink, GripVertical, Inbox, Link2, Pencil, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  REQ_STATUS_OPTIONS,
  normalizePriority,
  normalizeReqStatus,
  reqStatusLabel,
} from "@/lib/constants";
import { ReqStatusBadge } from "@/components/ui/StatusBadge";
import { DuePill, OwnerPill, PriorityPill, TagPill } from "@/components/ui/Pills";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { ProjectIcon, projectTone } from "@/components/projects/ProjectIcon";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityGlyph } from "@/components/ui/Glyphs";
import { useListDisplay, type ListProp } from "@/components/views/listDisplay";
import { REQ_STATUS_VISUAL } from "@/components/ui/statusVisual";
import { StatusDock, statusFromDropId, type DockStatus } from "@/components/board/StatusDock";
import { StatusMenu } from "@/components/board/StatusMenu";
import { useStatusMover } from "@/components/board/useStatusMover";
import { dockFirstCollision } from "@/components/board/collision";
import type { PoolRow } from "@/lib/requirements-pool";
import { NewRequirementButton, REQUIREMENT_CREATED_EVENT } from "./NewRequirementButton";
import { BulkBar, BulkTitleModal } from "@/components/bulk/BulkTitle";
import { BulkEditModal, ToBugModal } from "./BulkReqModals";
import { useToast } from "@/components/ui/Toast";

const toDock = (list: typeof REQ_STATUS_OPTIONS): DockStatus[] =>
  list.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    tone: s.key === "cancelled" ? "danger" : undefined,
  }));

function Handle({ id, title, disabled }: { id: string; title: string; disabled?: boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      className={`row-handle${isDragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      title={disabled ? undefined : `拖动「${title}」到底部状态抽屉`}
      aria-hidden="true"
    >
      {disabled ? null : <GripVertical size={14} className="row-handle-grip" />}
    </span>
  );
}

/**
 * 需求池表格：每行可以按住左侧把手拖到底部「状态抽屉」，或点状态胶囊直接选。
 * 新建成功后对应行高亮 1 秒（M13）。
 */
export function RequirementPoolTable({
  rows: initialRows,
  showProject,
  canMove,
  canEdit,
  emptyTitle,
  emptyBody,
  hideProps = [],
  createProps,
  flat = false,
}: {
  /** 不分组（工作台「我的工作」） */
  flat?: boolean;
  rows: PoolRow[];
  /** 是否显示「所属项目」标签（项目内的列表不显示） */
  showProject: boolean;
  canMove: boolean;
  /** 能否编辑 / 删除（默认同 canMove；接口仍会校验） */
  canEdit?: boolean;
  emptyTitle: string;
  emptyBody: React.ReactNode;
  /** 本页固定不显示的属性（如「我的待办」不显示负责人） */
  hideProps?: ListProp[];
  /** 提供时分组头显示「+」新建需求 */
  createProps?: { defaultProjectId?: string; lockProject?: boolean };
}) {
  const router = useRouter();
  const editable = canEdit ?? canMove;
  // 启用中的阶段（Figma 52）
  const statusOptions = useReqStatusOptions(createProps?.lockProject ? createProps.defaultProjectId : null);
  const optionsFor = useStatusOptionsFor();
  const DOCK = useMemo(() => toDock(statusOptions), [statusOptions]);

  const runLifecycle = useLifecycle();
  async function removeRow(r: PoolRow, action: "archive" | "delete" = "delete") {
    if (await runLifecycle("requirement", r.id, r.title, action)) setRows((prev) => prev.filter((x) => x.id !== r.id));
  }
  const [displayValue] = useListDisplay();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const [rows, setRows] = useState(() => initialRows.map((r) => ({ ...r, status: normalizeReqStatus(r.status) })));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // 多选：批量根据描述生成标题（Figma 07）
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [bulkEdit, setBulkEdit] = useState<string[] | null>(null);
  const [toBug, setToBug] = useState<string[] | null>(null);
  const skipNote = (skipped: { code: string; reason: string }[]) => (skipped.length ? `；跳过 ${skipped.length} 条（${skipped[0].code} ${skipped[0].reason}${skipped.length > 1 ? " 等" : ""}）` : "");
  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev);
      for (const id of ids) {
        if (on) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  const pendingHighlight = useRef<string | null>(null);

  useEffect(() => {
    setRows(initialRows.map((r) => ({ ...r, status: normalizeReqStatus(r.status) })));
    setSelected((prev) => new Set(Array.from(prev).filter((id) => initialRows.some((r) => r.id === id))));
    if (pendingHighlight.current && initialRows.some((r) => r.id === pendingHighlight.current)) {
      const id = pendingHighlight.current;
      pendingHighlight.current = null;
      setHighlight(id);
      window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1200);
    }
  }, [initialRows]);

  useEffect(() => {
    function onCreated(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) pendingHighlight.current = id;
    }
    window.addEventListener(REQUIREMENT_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(REQUIREMENT_CREATED_EVENT, onCreated);
  }, []);

  const { move, saving, failed } = useStatusMover({
    setItems: setRows,
    url: (id) => `/api/requirements/${id}/status`,
    labelOf: reqStatusLabel,
  });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const active = useMemo(() => rows.find((r) => r.id === activeId) || null, [rows, activeId]);

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const row = rows.find((r) => r.id === String(e.active.id));
    const to = statusFromDropId(e.over?.id);
    if (row && to && to !== row.status) void move(row, to);
  }

  const display = displayValue;
  const show = (k: ListProp) => display.props[k] && !hideProps.includes(k) && (k !== "project" || showProject);
  // 项目内的列表没有「按项目」分组，退回按状态
  const groupBy = flat ? "none" : display.group === "project" && !showProject ? "status" : display.group;
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "__all__", label: "", icon: null as React.ReactNode, rows }];
    const keyOf = (r: (typeof rows)[number]): [string, string] => {
      if (groupBy === "priority") {
        const k = normalizePriority(r.priority);
        return [k, `${PRIORITY_LABELS[k]?.label || k}优先级`];
      }
      if (groupBy === "owner") return r.owners[0] ? [`u:${r.owners[0].name}`, r.owners[0].name] : ["__none__", "未指派"];
      if (groupBy === "project") return r.project ? [`p:${r.project.id}`, r.project.name] : ["__none__", "未关联项目"];
      return [r.status, reqStatusLabel(r.status)];
    };
    const map = new Map<string, { key: string; label: string; icon: React.ReactNode; rows: typeof rows }>();
    for (const r of rows) {
      const [key, label] = keyOf(r);
      let g = map.get(key);
      if (!g) {
        let icon: React.ReactNode = null;
        if (groupBy === "status") {
          const V = REQ_STATUS_VISUAL[key];
          icon = V ? <V.Icon size={14} aria-hidden="true" /> : null;
        } else if (groupBy === "priority") icon = <PriorityGlyph priority={key} />;
        else if (groupBy === "owner" && r.owners[0]) icon = <Avatar name={r.owners[0].name} src={r.owners[0].avatarUrl} size={16} />;
        else if (groupBy === "project" && r.project) icon = <ProjectIcon name={r.project.name} size={16} />;
        g = { key, label, icon, rows: [] };
        map.set(key, g);
      }
      g.rows.push(r);
    }
    const list = Array.from(map.values());
    const statusOrder = REQ_STATUS_OPTIONS.map((o) => o.key); // 排序用全量顺序（停用阶段里残留的需求也能排到原位置）
    const prioOrder: readonly string[] = PRIORITY_OPTIONS;
    list.sort((a, b) => {
      // 「未指派 / 未关联项目」放最后
      if (a.key === "__none__" || b.key === "__none__") return a.key === "__none__" ? 1 : -1;
      if (groupBy === "status") return statusOrder.indexOf(a.key) - statusOrder.indexOf(b.key);
      if (groupBy === "priority") return prioOrder.indexOf(a.key) - prioOrder.indexOf(b.key);
      return b.rows.length - a.rows.length || a.label.localeCompare(b.label, "zh-CN");
    });
    return list;
  }, [rows, groupBy]);

  if (rows.length === 0) {
    return (
      <div className="empty-state" role="status">
        <Inbox size={28} aria-hidden="true" className="empty-icon" />
        <p className="empty-title">{emptyTitle}</p>
        <div className="mt-2 text-neutral-500">{emptyBody}</div>
      </div>
    );
  }

  return (
    <DndContext
      id="req-pool-dnd"
      sensors={sensors}
      collisionDetection={dockFirstCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        screenReaderInstructions: { draggable: "可用状态胶囊通过键盘更改状态。" },
        announcements: {
          onDragStart: () => "已拿起需求",
          onDragOver: ({ over }) => (over ? "可放入" : "未在状态抽屉上"),
          onDragEnd: ({ over }) => (over ? "已放下" : "已放回原处"),
          onDragCancel: () => "已取消拖动",
        },
      }}
    >
      <div className={`nv-list${selected.size ? " has-selection" : ""}`} role="list" aria-label={`需求列表，共 ${rows.length} 条`}>
        {groups.map((g) => {
          const isOpen = !collapsed.has(g.key);
          return (
            <div key={g.key} className="nv-group" role="presentation">
              {g.key !== "__all__" ? (
                <div className="nv-group-head">
                  <button
                    type="button"
                    className="nv-group-toggle"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "收起" : "展开"}「${g.label}」分组`}
                    onClick={() => toggleGroup(g.key)}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {editable ? (
                    <input
                      type="checkbox"
                      className="nv-row-check"
                      aria-label={`选择「${g.label}」分组的全部需求`}
                      checked={g.rows.every((r) => selected.has(r.id))}
                      ref={(el) => {
                        if (el) el.indeterminate = g.rows.some((r) => selected.has(r.id)) && !g.rows.every((r) => selected.has(r.id));
                      }}
                      onChange={(e) => setMany(g.rows.map((r) => r.id), e.target.checked)}
                    />
                  ) : null}
                  {g.icon}
                  <span className="nv-group-name">{g.label}</span>
                  <span className="nv-group-count">{g.rows.length}</span>
                  <span className="flex-1" />
                  {createProps ? (
                    <NewRequirementButton
                      {...createProps}
                      iconOnly
                      label={`新建需求`}
                      className="icon-button nv-group-act"
                    />
                  ) : null}
                  <ActionMenu
                    label={`「${g.label}」分组操作`}
                    items={[
                      { label: isOpen ? "收起此分组" : "展开此分组", onSelect: () => toggleGroup(g.key) },
                      { label: "展开全部分组", onSelect: () => setCollapsed(new Set()) },
                      { label: "收起其他分组", onSelect: () => setCollapsed(new Set(groups.map((x) => x.key).filter((k) => k !== g.key))) },
                    ]}
                  />
                </div>
              ) : null}
              {isOpen
                ? g.rows.map((r) => {
                    const fail = failed[r.id];
                    const done = r.status === "online" || r.status === "cancelled";
                    return (
                      <div
                        key={r.id}
                        role="listitem"
                        className={`nv-row${highlight === r.id ? " row-flash" : ""}${activeId === r.id ? " row-lifted" : ""}${selected.has(r.id) ? " is-selected" : ""}`}
                        aria-busy={saving.has(r.id) || undefined}
                      >
                        <span className="nv-row-lead">
                          {editable ? (
                            <input
                              type="checkbox"
                              className="nv-row-check"
                              aria-label={`选择 ${r.code}`}
                              checked={selected.has(r.id)}
                              onChange={(e) => setMany([r.id], e.target.checked)}
                            />
                          ) : null}
                          <Handle id={r.id} title={r.title} disabled={!canMove || saving.has(r.id)} />
                        </span>
                        <span className="nv-row-code">{r.code}</span>
                        <span className="nv-row-title">
                          <Link href={`/requirements/${r.id}`} className="nv-row-link" title={r.title}>
                            {r.title}
                          </Link>
                          {fail ? (
                            <span className="row-error" role="alert">
                              <AlertCircle size={12} aria-hidden="true" />
                              {fail.message}
                              {!fail.unknown ? (
                                <button type="button" className="board-card-retry" onClick={() => void move(r, fail.to)}>
                                  <RotateCcw size={12} aria-hidden="true" />
                                  重试
                                </button>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <span className="nv-row-props">
                          {saving.has(r.id) ? <span className="spinner spinner-delayed" aria-label="保存中" /> : null}
                          {show("status") ? (
                            canMove ? (
                              <StatusMenu
                                trigger="badge"
                                options={optionsFor(r.project?.id)}
                                current={r.status}
                                disabled={saving.has(r.id)}
                                onSelect={(to) => void move(r, to)}
                                align="left"
                                visualOf={(k) => REQ_STATUS_VISUAL[k]}
                              />
                            ) : (
                              <ReqStatusBadge status={r.status} />
                            )
                          ) : null}
                          {show("priority") ? <PriorityPill priority={r.priority} /> : null}
                          {show("owner") ? <OwnerPill owners={r.owners} /> : null}
                          {show("due") ? <DuePill date={r.plannedEndAt} done={done} /> : null}
                          {show("project") && r.project ? (
                            <TagPill label={r.project.name} color={projectTone(r.project.name)} />
                          ) : null}
                        </span>
                        <span className="nv-row-more">
                          <ActionMenu
                            label={`「${r.title}」更多操作`}
                            items={[
                              { label: editable ? "编辑" : "打开详情", icon: editable ? Pencil : ExternalLink, onSelect: () => router.push(`/requirements/${r.id}`) },
                              {
                                label: "复制链接",
                                icon: Link2,
                                onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}/requirements/${r.id}`),
                              },
                              ...(editable
                                ? [
                                    { label: "移入 Bug", icon: Bug, onSelect: () => setToBug([r.id]) },
                                    { label: "归档", icon: Archive, divider: true, onSelect: () => void removeRow(r, "archive") },
                                    { label: "删除", icon: Trash2, tone: "danger" as const, onSelect: () => void removeRow(r) },
                                  ]
                                : []),
                            ]}
                          />
                        </span>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
      {editable && !active && !bulk && !bulkEdit && !toBug ? (
        <BulkBar
          kind="requirement"
          count={selected.size}
          onGenerate={() => setBulk(Array.from(selected))}
          onClear={() => setSelected(new Set())}
          actions={[
            { label: "批量设置", icon: <SlidersHorizontal size={14} aria-hidden="true" />, onClick: () => setBulkEdit(Array.from(selected)) },
            { label: "移入 Bug", icon: <Bug size={14} aria-hidden="true" />, onClick: () => setToBug(Array.from(selected)) },
          ]}
        />
      ) : null}
      {bulkEdit ? (
        <BulkEditModal
          ids={bulkEdit}
          onClose={() => setBulkEdit(null)}
          onDone={(n, skipped) => {
            setBulkEdit(null);
            setSelected(new Set());
            toast.success(`已批量设置 ${n} 条需求${skipNote(skipped)}`);
            router.refresh();
          }}
        />
      ) : null}
      {toBug ? (
        <ToBugModal
          ids={toBug}
          needProject={toBug.some((id) => !rows.find((r) => r.id === id)?.project)}
          onClose={() => setToBug(null)}
          onDone={(n, keep, skipped, movedIds) => {
            setToBug(null);
            setSelected(new Set());
            if (!keep) setRows((prev) => prev.filter((r) => !movedIds.includes(r.id)));
            toast.success(`已移入 ${n} 个 Bug${keep ? "，原需求已保留并关联" : "，原需求在回收站（30 天内可恢复）"}${skipNote(skipped)}`);
            router.refresh();
          }}
        />
      ) : null}
      {bulk ? (
        <BulkTitleModal
          kind="requirement"
          ids={bulk}
          onClose={() => setBulk(null)}
          onDone={(updated, denied) => {
            setBulk(null);
            setRows((prev) => prev.map((r) => ({ ...r, title: updated.find((u) => u.id === r.id)?.title ?? r.title })));
            setSelected(new Set());
            if (denied.length) toast.error(`已更新 ${updated.length} 条；${denied.join("、")} 没有编辑权限`);
            else toast.success(`已更新 ${updated.length} 条需求的标题`);
            router.refresh();
          }}
        />
      ) : null}
      {canMove ? (
        <StatusDock statuses={DOCK} activeStatus={active?.status ?? null} visible={!!active} />
      ) : null}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="drag-chip">
            <GripVertical size={14} aria-hidden="true" />
            <span className="truncate">{active.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
