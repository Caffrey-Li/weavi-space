"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RELEASE_STATUS } from "@/lib/constants";
import { ActionMenu } from "@/components/ui/ActionMenu";

type Action = {
  next: string;
  label: string;
  when: (status: string) => boolean;
  tone: "primary" | "secondary" | "ghost" | "danger";
  confirm: (ctx: { version: string; pending: number; total: number }) => string;
};

const ACTIONS: Action[] = [
  {
    next: "frozen",
    label: "冻结",
    when: (s) => s === "planning",
    tone: "secondary",
    confirm: ({ version, total }) => `冻结 v${version} 后，关联需求（当前 ${total} 条）不能再增减，需解除冻结才能调整。`,
  },
  {
    next: "releasing",
    label: "开始发布",
    when: (s) => s === "frozen" || s === "planning",
    tone: "secondary",
    confirm: ({ version }) => `v${version} 状态将变为「发布中」。`,
  },
  {
    next: "released",
    label: "标记已上线",
    when: (s) => s === "planning" || s === "frozen" || s === "releasing",
    tone: "primary",
    confirm: ({ version }) => `将 v${version} 标记为「已上线」并记录上线时间。上线后版本内容不可再修改，状态也不能撤回。`,
  },
  {
    next: "planning",
    label: "解除冻结",
    when: (s) => s === "frozen",
    tone: "ghost",
    confirm: ({ version }) => `v${version} 将回到「规划中」，可以重新调整关联需求。`,
  },
  {
    next: "cancelled",
    label: "取消发版",
    when: (s) => s === "planning" || s === "frozen" || s === "releasing",
    tone: "danger",
    confirm: ({ version }) => `v${version} 将标记为「已取消」。关联需求的状态不会改变，之后可恢复为规划中。`,
  },
  {
    next: "planning",
    label: "恢复为规划中",
    when: (s) => s === "cancelled",
    tone: "secondary",
    confirm: ({ version }) => `v${version} 将从「已取消」恢复为「规划中」。`,
  },
];

/** 发版状态动作（M16）：先说明对象与影响，确认后 pending，服务端明确成功才更新。 */
export function ReleaseActions({
  releaseId,
  status,
  version,
  pendingRequirements,
  totalRequirements,
  pendingBugs = 0,
  canManage = true,
  compact = false,
}: {
  /** 页头紧凑模式：主动作为按钮，其余收进「…」 */
  compact?: boolean;
  releaseId: string;
  status: string;
  version: string;
  /** 关联需求中尚未上线 / 未取消的条数 */
  pendingRequirements: number;
  totalRequirements: number;
  /** 关联 Bug 中尚未解决的个数（紧急发版） */
  pendingBugs?: number;
  canManage?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [sync, setSync] = useState(true);
  const [resolveBugs, setResolveBugs] = useState(true);

  async function apply(a: Action) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/releases/${releaseId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: a.next,
          syncRequirements: a.next === "released" && sync,
          resolveBugs: a.next === "released" && pendingBugs > 0 && resolveBugs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "状态更新失败，当前状态未改变");
        return;
      }
      setPending(null);
      const synced = (data as { synced?: number }).synced || 0;
      const resolved = (data as { resolved?: number }).resolved || 0;
      toast.success(
        `v${version} 已${a.next === "planning" && status === "cancelled" ? "恢复为规划中" : `改为「${RELEASE_STATUS[a.next]?.label}」`}${
          synced ? `，${synced} 条需求同步为已上线` : ""
        }${resolved ? `，${resolved} 个 Bug 标记为已解决` : ""}`,
      );
      router.refresh();
    } catch {
      setError("网络异常，结果未确认。请刷新页面核对状态后再操作。");
    } finally {
      setLoading(false);
    }
  }

  if (!canManage) {
    if (compact) return null;
    return <p className="text-sm text-neutral-500">当前账号没有发版管理权限。</p>;
  }

  const available = ACTIONS.filter((a) => a.when(status));
  const cls = (t: Action["tone"]) =>
    t === "primary" ? "btn-primary" : t === "ghost" ? "btn-ghost" : t === "danger" ? "btn-danger" : "btn-secondary";

  const open = (a: Action) => {
    setError("");
    setSync(true);
    setResolveBugs(true);
    setPending(a);
  };
  const primary = available.find((a) => a.tone === "primary");
  const rest = available.filter((a) => a !== primary);

  return (
    <div className={compact ? "nv-release-actions" : "space-y-2"}>
      {compact ? (
        <>
          {rest.length ? (
            <ActionMenu
              label={`v${version} 更多发版操作`}
              items={rest.map((a) => ({ label: a.label, tone: a.tone === "danger" ? "danger" : undefined, onSelect: () => open(a) }))}
            />
          ) : null}
          {primary ? (
            <button type="button" className="btn-primary nv-head-btn" disabled={loading} onClick={() => open(primary)}>
              {primary.label === "标记已上线" ? "标记上线" : primary.label}
            </button>
          ) : null}
        </>
      ) : available.length ? (
        <div className="flex flex-wrap gap-2">
          {available.map((a) => (
            <button
              key={a.label}
              type="button"
              className={cls(a.tone)}
              disabled={loading}
              onClick={() => {
                setError("");
                setSync(true);
                setPending(a);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">该版本已上线，状态不可再变更。</p>
      )}

      <Modal
        open={!!pending}
        onClose={() => {
          if (!loading) setPending(null);
        }}
        title={pending ? `${pending.label} · v${version}` : "确认"}
        busy={loading}
      >
        {pending ? (
          <div className="space-y-4">
            {error ? (
              <div role="alert" className="banner-error">
                {error}
              </div>
            ) : null}
            <p className="text-sm text-neutral-700">
              {pending.confirm({ version, pending: pendingRequirements, total: totalRequirements })}
            </p>
            {pending.next === "released" ? (
              pendingRequirements > 0 ? (
                <label className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={sync} onChange={(e) => setSync(e.target.checked)} />
                  <span>
                    同时把 <strong>{pendingRequirements}</strong> 条尚未上线的关联需求标记为「已上线」
                    <span className="block text-xs text-neutral-500">已取消的需求不受影响；每条需求都会记录变更动态。</span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-neutral-500">关联需求均已上线或已取消，无需同步。</p>
              )
            ) : null}
            {pending.next === "released" && pendingBugs > 0 ? (
              <label className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
                <input type="checkbox" className="mt-0.5" checked={resolveBugs} onChange={(e) => setResolveBugs(e.target.checked)} />
                <span>
                  同时把 <strong>{pendingBugs}</strong> 个未解决的关联 Bug 标记为「已解决」
                  <span className="block text-xs text-neutral-500">之后由测试验证关闭；每个 Bug 都会记录变更动态。</span>
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                data-initial-focus=""
                onClick={() => setPending(null)}
              >
                再想想
              </button>
              <button
                type="button"
                className={pending.tone === "danger" ? "btn-danger" : "btn-primary"}
                disabled={loading}
                aria-busy={loading || undefined}
                onClick={() => void apply(pending)}
              >
                {loading ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
                {loading ? "处理中…" : `确认${pending.label}`}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
