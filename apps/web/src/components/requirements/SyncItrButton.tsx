"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** 从飞书排期表同步需求。结果以服务端返回的数量为准。 */
export function SyncItrButton({ label = "同步排期表", className = "btn-secondary" }: { label?: string; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function onSync() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sync/itr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`排期表同步失败：${data.error || res.statusText}`);
        return;
      }
      toast.success(`排期表同步完成：新建 ${data.created}，更新 ${data.updated}，跳过 ${data.skipped}（共 ${data.total}）`);
      router.refresh();
    } catch {
      toast.error("网络异常，同步结果未确认；请稍后刷新查看，勿连续重复同步");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onSync}
      disabled={loading}
      aria-busy={loading || undefined}
      title="从飞书排期表拉取并更新需求"
    >
      {loading ? <span className="spinner spinner-delayed" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
      {loading ? "同步中…" : label}
    </button>
  );
}
