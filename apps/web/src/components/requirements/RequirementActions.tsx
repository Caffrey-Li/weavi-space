"use client";

import { useReqStatusOptions } from "@/components/requirements/ReqStagesContext";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { normalizeReqStatus, reqStatusLabel } from "@/lib/constants";
import { StatusMenu } from "@/components/board/StatusMenu";
import { useStatusMover } from "@/components/board/useStatusMover";
import { useToast } from "@/components/ui/Toast";
import { ReqStatusBadge } from "@/components/ui/StatusBadge";
import { REQ_STATUS_VISUAL } from "@/components/ui/statusVisual";
import { RequirementFormModal, requirementPayload, type RequirementFormValues } from "./RequirementForm";

/** 需求详情页右上角：改状态（同看板接口）+ 编辑。 */
export function RequirementActions({
  id,
  title,
  status,
  canMove,
  canEdit,
  editValues,
  part = "all",
}: {
  id: string;
  title: string;
  status: string;
  canMove: boolean;
  canEdit: boolean;
  editValues?: RequirementFormValues;
  /** status：只渲染状态切换（放在属性区）；edit：只渲染编辑按钮；all：都渲染 */
  part?: "all" | "status" | "edit";
}) {
  const statusOptions = useReqStatusOptions();
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState([{ id, title, status: normalizeReqStatus(status) }]);
  const [editing, setEditing] = useState(false);
  const current = items[0];

  useEffect(() => {
    setItems([{ id, title, status: normalizeReqStatus(status) }]);
  }, [id, title, status]);

  const { move, saving, failed } = useStatusMover({
    setItems,
    url: (rid) => `/api/requirements/${rid}/status`,
    labelOf: reqStatusLabel,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {part !== "edit" && !canMove ? <ReqStatusBadge status={current.status} /> : null}
      {part !== "edit" && canMove ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusMenu
            visualOf={(k) => REQ_STATUS_VISUAL[k]}
            align="left"
            trigger="badge"
            options={statusOptions}
            current={current.status}
            disabled={saving.has(id)}
            onSelect={(to) => void move(current, to)}
          />
          {saving.has(id) ? <span className="spinner spinner-delayed" aria-label="保存中" /> : null}
          {failed[id] ? (
            <span className="text-xs text-nv-danger-fg" role="alert">
              {failed[id].message}
            </span>
          ) : null}
        </div>
      ) : null}
      {part !== "status" && canEdit ? (
        <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
          <Pencil size={15} aria-hidden="true" />
          编辑
        </button>
      ) : null}
      {part !== "status" && canEdit && editValues ? (
        <RequirementFormModal
          open={editing}
          mode="edit"
          initial={editValues}
          onClose={() => setEditing(false)}
          onSubmit={async (values) => {
            const res = await fetch(`/api/requirements/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requirementPayload(values)),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return (data as { error?: string }).error || "保存失败，输入已保留";
            setEditing(false);
            const changed = (data as { changed?: string[] }).changed || [];
            toast.success(changed.length ? `已保存：${changed.join("、")}` : "没有需要保存的改动");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}
