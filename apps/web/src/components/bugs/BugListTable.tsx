"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BUG_STATUS_OPTIONS, bugStatusLabel } from "@/lib/constants";
import { StatusMenu } from "@/components/board/StatusMenu";
import { useStatusMover } from "@/components/board/useStatusMover";
import Link from "next/link";
import { RotateCcw, Trash2, UserRound } from "lucide-react";
import { BugStatusBadge, bugCode } from "@/components/ui/StatusBadge";
import { SeverityDot } from "@/components/ui/Glyphs";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { SEVERITY_LABELS } from "@/lib/constants";
import { fmtAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { BUG_STATUS_VISUAL } from "@/components/ui/statusVisual";
import type { BugCard } from "@/components/board/BugBoard";
import { BulkBar, BulkTitleModal } from "@/components/bulk/BulkTitle";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";

/** Bug 列表（Figma 10 表格）：点标题进 Bug 详情页（11-05），被退回过的标出次数；状态胶囊直接改。 */
export function BugListTable({
  rows: initial,
  canEdit,
  canDelete = false,
  focusId,
  hideProject = false,
}: {
  rows: BugCard[];
  canEdit: boolean;
  /** 角色有 bugs.delete：显示勾选和删除入口；接口仍逐条校验 */
  canDelete?: boolean;
  focusId?: string;
  hideProject?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const runLifecycle = useLifecycle();
  const canSelect = canEdit || canDelete;
  const rowClass = `${canSelect ? " has-check" : ""}${canDelete ? " has-menu" : ""}${hideProject ? " no-project" : ""}`;
  useEffect(() => {
    setRows(initial);
    // 翻页 / 筛选后只保留仍在列表里的勾选
    setSelected((prev) => new Set(Array.from(prev).filter((id) => initial.some((r) => r.id === id))));
  }, [initial]);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = rows.some((r) => selected.has(r.id));

  const { move, saving } = useStatusMover<BugCard>({
    setItems: setRows,
    url: (id) => `/api/bugs/${id}/status`,
    labelOf: bugStatusLabel,
    noun: "Bug",
  });

  function dropRows(ids: string[]) {
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelected((prev) => new Set(Array.from(prev).filter((id) => !ids.includes(id))));
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length || deleting) return;
    const ok = await confirm({
      title: `删除选中的 ${ids.length} 个 Bug？`,
      body: "删除后移入回收站。30 天内可以在「设置 › 归档与回收站」恢复，之后自动彻底删除。",
      confirmLabel: `删除 ${ids.length} 个`,
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    const res = await fetch("/api/bugs/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setDeleting(false);
    if (!res?.ok) return toast.error((d as { error?: string }).error || "删除失败，请重试");
    const { deleted = [], skipped = [] } = d as { deleted?: string[]; skipped?: { id: string; reason: string }[] };
    dropRows(deleted);
    if (skipped.length) {
      const first = skipped[0];
      toast.error(`已删除 ${deleted.length} 个，${skipped.length} 个未删除：${bugCode(first.id)} ${first.reason}${skipped.length > 1 ? " 等" : ""}`);
    } else toast.success(`已删除 ${deleted.length} 个 Bug，可在回收站恢复`);
    router.refresh();
  }

  return (
    <>
      <div className="nv-bug-table" role="table" aria-label={`Bug 列表（当前页 ${rows.length} 个）`}>
        <div className={`nv-bug-row is-head${rowClass}`} role="row">
          {canSelect ? (
            <span role="columnheader" className="nv-bug-check">
              <input
                type="checkbox"
                aria-label={allOn ? "取消全选" : "全选当前页"}
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn && !allOn;
                }}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            </span>
          ) : null}
          <span role="columnheader">编号</span>
          <span role="columnheader">标题</span>
          <span role="columnheader">严重程度</span>
          <span role="columnheader">状态</span>
          {hideProject ? null : <span role="columnheader">所属项目</span>}
          <span role="columnheader">关联需求</span>
          <span role="columnheader">前端 / 后端</span>
          <span role="columnheader">更新</span>
          {canDelete ? <span role="columnheader" aria-label="操作" /> : null}
        </div>
        {rows.map((b) => (
          <div
            key={b.id}
            role="row"
            aria-selected={canSelect ? selected.has(b.id) : undefined}
            className={`nv-bug-row${rowClass}${focusId === b.id ? " row-flash" : ""}${selected.has(b.id) ? " is-selected" : ""}`}
          >
            {canSelect ? (
              <span role="cell" className="nv-bug-check">
                <input type="checkbox" aria-label={`选择 ${bugCode(b.id)}`} checked={selected.has(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
              </span>
            ) : null}
            <span role="cell" className="nv-bug-code">{bugCode(b.id)}</span>
            <span role="cell" className="nv-bug-title">
              <Link href={`/bugs/${b.id}`} title={b.title}>
                {b.title}
              </Link>
              {b.reopenCount ? (
                <span className="nv-tag is-warning bug-return-tag" title={`被退回 ${b.reopenCount} 次（从已解决 / 已关闭改回待处理、进行中或重新打开）`} aria-label={`被退回 ${b.reopenCount} 次`}>
                  <RotateCcw size={12} aria-hidden="true" />
                  {b.reopenCount}
                </span>
              ) : null}
            </span>
            <span role="cell" className="nv-bug-sev">
              <SeverityDot severity={b.severity} />
              {SEVERITY_LABELS[b.severity] || b.severity}
            </span>
            <span role="cell" className="nv-bug-status">
              {canEdit ? (
                <>
                  <StatusMenu
                    trigger="badge"
                    options={BUG_STATUS_OPTIONS}
                    current={b.status}
                    disabled={saving.has(b.id)}
                    onSelect={(to) => void move(b, to)}
                    align="left"
                    visualOf={(k) => BUG_STATUS_VISUAL[k]}
                  />
                  {saving.has(b.id) ? <span className="spinner spinner-delayed" aria-label="保存中" /> : null}
                </>
              ) : (
                <BugStatusBadge status={b.status} />
              )}
            </span>
            {hideProject ? null : (
              <span role="cell" className="nv-bug-project">
                {b.projectName ? (
                  <>
                    <ProjectIcon name={b.projectName} src={b.projectIconUrl} size={16} />
                    <span>{b.projectName}</span>
                  </>
                ) : (
                  <span className="text-tertiary">未归属</span>
                )}
              </span>
            )}
            <span role="cell" className="nv-bug-req">
              {b.requirementId ? (
                <Link href={`/requirements/${b.requirementId}`} title={b.requirementTitle || undefined}>
                  {b.requirementCode || "需求"}
                </Link>
              ) : (
                <span className="text-tertiary">—</span>
              )}
            </span>
            <span role="cell" className="nv-bug-owner" title={`前端：${b.frontendName || "未指派"} · 后端：${b.backendName || "未指派"}`}>
              {b.frontendName || b.backendName ? (
                <>
                  {b.frontendName ? <Avatar name={b.frontendName} src={b.frontendAvatarUrl} size={16} /> : null}
                  {b.backendName ? <Avatar name={b.backendName} src={b.backendAvatarUrl} size={16} /> : null}
                  <span>
                    {b.frontendName || "—"} / {b.backendName || "—"}
                  </span>
                </>
              ) : (
                <span className="nv-bug-unassigned">
                  <UserRound size={14} aria-hidden="true" />
                  未指派
                </span>
              )}
            </span>
            <span role="cell" className="nv-bug-time">{fmtAgo(b.updatedAt || b.createdAt)}</span>
            {canDelete ? (
              <span role="cell" className="nv-bug-menu">
                <ActionMenu
                  label={`${bugCode(b.id)} 更多操作`}
                  items={[{ label: "删除 Bug", icon: Trash2, tone: "danger", onSelect: () => void runLifecycle("bug", b.id, b.title, "delete", () => dropRows([b.id])) }]}
                />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {canSelect && !bulk ? (
        <BulkBar
          kind="bug"
          count={selected.size}
          onGenerate={canEdit ? () => setBulk(Array.from(selected)) : undefined}
          onDelete={canDelete ? () => void deleteSelected() : undefined}
          deleting={deleting}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      {bulk ? (
        <BulkTitleModal
          kind="bug"
          ids={bulk}
          onClose={() => setBulk(null)}
          onDone={(updated, denied) => {
            setBulk(null);
            setRows((prev) => prev.map((r) => ({ ...r, title: updated.find((u) => u.id === r.id)?.title ?? r.title })));
            setSelected(new Set());
            if (denied.length) toast.error(`已更新 ${updated.length} 条；${denied.join("、")} 没有编辑权限`);
            else toast.success(`已更新 ${updated.length} 个 Bug 的标题`);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
