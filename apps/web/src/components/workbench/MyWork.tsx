"use client";

import { useReqStatusOptions } from "@/components/requirements/ReqStagesContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ASSIGNEE_ROLE_LABELS,
  BUG_STATUS_OPTIONS,
  SEVERITY_LABELS,
  bugStatusLabel,
  normalizeReqStatus,
  reqStatusLabel,
} from "@/lib/constants";
import { StatusMenu } from "@/components/board/StatusMenu";
import { useStatusMover } from "@/components/board/useStatusMover";
import { dueInfo } from "@/components/board/due";

export type MyReq = {
  id: string;
  title: string;
  status: string;
  projectName: string | null;
  myRoles: string[];
  plannedEndAt: string | null;
};
export type MyBug = { id: string; title: string; status: string; severity: string; projectId: string | null; projectName: string | null };

/** 工作台「我的待办」：直接在这里推进状态，不必先找到看板。 */
export function MyRequirements({ items: initial, canMove }: { items: MyReq[]; canMove: boolean }) {
  const statusOptions = useReqStatusOptions();
  const [items, setItems] = useState(() => initial.map((i) => ({ ...i, status: normalizeReqStatus(i.status) })));
  useEffect(() => setItems(initial.map((i) => ({ ...i, status: normalizeReqStatus(i.status) }))), [initial]);
  const { move, saving } = useStatusMover({
    setItems,
    url: (id) => `/api/requirements/${id}/status`,
    labelOf: reqStatusLabel,
  });
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((r) => {
        const due = dueInfo(r.plannedEndAt, false);
        return (
          <li key={r.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/requirements/${r.id}`} className="block truncate text-sm font-medium hover:text-brand-600" title={r.title}>
                {r.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-neutral-500">
                {r.projectName || "未归属项目"} · 我是{r.myRoles.map((x) => ASSIGNEE_ROLE_LABELS[x] || x).join("、")}
                {due ? <span suppressHydrationWarning className={due.overdue ? " font-medium text-nv-danger-fg" : ""}> · {due.label}</span> : null}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {canMove ? (
                <StatusMenu trigger="badge" options={statusOptions} current={r.status} disabled={saving.has(r.id)} onSelect={(to) => void move(r, to)} />
              ) : (
                <span className="text-xs text-neutral-600">{reqStatusLabel(r.status)}</span>
              )}
              {saving.has(r.id) ? <span className="spinner spinner-delayed" aria-label="保存中" /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MyBugs({ items: initial, canEdit }: { items: MyBug[]; canEdit: boolean }) {
  const [items, setItems] = useState(initial);
  useEffect(() => setItems(initial), [initial]);
  const { move, saving } = useStatusMover({
    setItems,
    url: (id) => `/api/bugs/${id}/status`,
    labelOf: bugStatusLabel,
    noun: "Bug",
  });
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((b) => (
        <li key={b.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Link
              href={`/my/bugs?bug=${b.id}`}
              className="block truncate text-sm font-medium hover:text-brand-600"
              title={b.title}
            >
              {b.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {b.projectName || "—"} · {SEVERITY_LABELS[b.severity] || b.severity}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {canEdit ? (
              <StatusMenu trigger="badge" options={BUG_STATUS_OPTIONS} current={b.status} disabled={saving.has(b.id)} onSelect={(to) => void move(b, to)} />
            ) : (
              <span className="text-xs text-neutral-600">{bugStatusLabel(b.status)}</span>
            )}
            {saving.has(b.id) ? <span className="spinner spinner-delayed" aria-label="保存中" /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
