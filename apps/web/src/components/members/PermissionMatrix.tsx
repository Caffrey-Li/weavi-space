"use client";

import { useState } from "react";
import { ROLE_LABELS } from "@/lib/constants";

type Feature = { key: string; label: string };
type PermRow = { role: string; feature: string; allowed: boolean };

export function PermissionMatrix({
  features,
  roles,
  initial,
  canEdit,
}: {
  features: Feature[];
  roles: string[];
  initial: PermRow[];
  canEdit: boolean;
}) {
  const [matrix, setMatrix] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const r of initial) m[`${r.role}::${r.feature}`] = r.allowed;
    return m;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  async function toggle(role: string, feature: string, featureLabel: string) {
    if (!canEdit) return;
    const key = `${role}::${feature}`;
    if (busy) return;
    const next = !matrix[key];
    setMatrix((prev) => ({ ...prev, [key]: next }));
    setBusy(key);
    setError("");
    setOkMsg("");
    try {
      const res = await fetch("/api/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "project", role, feature, allowed: next }),
      });
      setBusy(null);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMatrix((prev) => ({ ...prev, [key]: !next }));
        setError((data as { error?: string }).error || "保存失败，已恢复原值");
        return;
      }
      setOkMsg(
        `已更新：${ROLE_LABELS[role] || role} · ${featureLabel} → ${next ? "允许" : "禁止"}`
      );
    } catch {
      setBusy(null);
      setMatrix((prev) => ({ ...prev, [key]: !next }));
      setError("网络异常，已恢复原值");
    }
  }

  return (
    <section className="mt-0">
      {!canEdit ? (
        <p className="mb-2 text-xs text-neutral-500">当前为只读视图；权限变更以服务端授权为准。</p>
      ) : (
        <p className="mb-2 text-xs text-neutral-500">点击开关立即保存；失败会恢复原值并提示原因。</p>
      )}
      {error ? (
        <div role="alert" className="banner-error mb-2" tabIndex={-1}>
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div role="status" className="banner-success mb-2">
          {okMsg}
        </div>
      ) : null}
      <div className="card overflow-x-auto">
        <table className="table-compact w-full min-w-[720px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-nv-bg-surface">功能 \ 岗位角色</th>
              {roles.map((r) => (
                <th key={r} className="whitespace-nowrap text-center">
                  {ROLE_LABELS[r] || r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.key}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-nv-bg-surface text-sm font-medium">
                  {f.label}
                </td>
                {roles.map((r) => {
                  const key = `${r}::${f.key}`;
                  const on = !!matrix[key];
                  const roleLabel = ROLE_LABELS[r] || r;
                  const name = `${roleLabel} · ${f.label}：当前${on ? "允许" : "禁止"}`;
                  return (
                    <td key={key} className="text-center">
                      <button
                        type="button"
                        disabled={!canEdit || busy === key}
                        onClick={() => toggle(r, f.key, f.label)}
                        className={`perm-switch inline-flex h-6 w-10 items-center rounded-full ${
                          on ? "bg-brand-500" : "bg-neutral-200"
                        } ${!canEdit ? "cursor-default opacity-60" : "cursor-pointer"}`}
                        aria-pressed={on}
                        aria-label={name}
                        title={name}
                        aria-busy={busy === key || undefined}
                      >
                        <span
                          className={`perm-knob h-4 w-4 rounded-full bg-white shadow ${
                            on ? "translate-x-5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
