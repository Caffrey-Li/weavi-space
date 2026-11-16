"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { Kind } from "@/lib/lifecycle-shared";

/** 已归档内容的详情页顶部提示：只读查看，可一键恢复 */
export function ArchivedBar({ kind, id, label, canRestore }: { kind: Kind; id: string; label: string; canRestore: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    const res = await fetch("/api/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, action: "unarchive" }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(d.error || "恢复失败");
    toast.success("已取消归档");
    router.refresh();
  }
  return (
    <div className="nv-archived-bar" role="status">
      <Archive size={14} aria-hidden="true" />
      <span className="flex-1">这个{label}已归档，不会出现在列表和看板里。</span>
      {canRestore ? (
        <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void restore()}>
          {busy ? "恢复中…" : "取消归档"}
        </button>
      ) : null}
    </div>
  );
}
