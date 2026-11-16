"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REQ_STATUS, STAGE_GROUP_LABEL } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

type Data = { hidden: string[]; counts: Record<string, number>; locked: string[]; canEdit: boolean };

/** 需求阶段配置（Figma 52）：勾选启用的阶段；新停用且还有需求的阶段要选迁移目标 */
export function ReqStagesForm() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [migrate, setMigrate] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/system/req-stages", { cache: "no-store" });
    const d = (await res.json().catch(() => null)) as Data | null;
    if (!res.ok || !d) return setError("读取失败，请刷新重试");
    setData(d);
    setHidden(d.hidden);
    setMigrate({});
  }
  useEffect(() => {
    void load();
  }, []);

  if (!data) return <div className="nv-set">{error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>}</div>;

  const enabled = REQ_STATUS.map((s) => s.key as string).filter((k) => !hidden.includes(k));
  // 新停用、且还有需求的阶段：需要迁移
  const needMove = hidden.filter((s) => !data.hidden.includes(s) && (data.counts[s] || 0) > 0);
  const defaultTarget = (s: string) => {
    const all = REQ_STATUS.map((x) => x.key as string);
    const i = all.indexOf(s);
    return all.slice(i + 1).find((k) => enabled.includes(k) && k !== "cancelled") || enabled[0];
  };
  const dirty = JSON.stringify([...hidden].sort()) !== JSON.stringify([...data.hidden].sort());

  function toggle(key: string, on: boolean) {
    setHidden((h) => (on ? h.filter((x) => x !== key) : [...h, key]));
  }

  async function save() {
    if (busy || !dirty) return;
    const moves = needMove.map((s) => ({ from: s, to: migrate[s] || defaultTarget(s), n: data!.counts[s] }));
    if (moves.length) {
      const ok = await confirm({
        title: "停用阶段并迁移需求？",
        body: moves.map((m) => `「${m.from}」的 ${m.n} 条需求会改为「${m.to}」`).join("；") + "。每条都会记一条动态。",
        confirmLabel: "停用并迁移",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/system/req-stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden, migrate: Object.fromEntries(moves.map((m) => [m.from, m.to])) }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "保存失败，请重试");
    const migrated = ((d as { migrated?: { count: number }[] }).migrated || []).reduce((n, m) => n + m.count, 0);
    toast.success(migrated ? `已保存，${migrated} 条需求已迁移` : "已保存阶段设置");
    await load();
    router.refresh();
  }

  return (
    <div className="nv-set">
      <div className="nv-set-title">
        <h1>阶段管理</h1>
        <p>勾选要使用的阶段：看板列、状态抽屉、状态菜单和需求池筛选只显示勾选的阶段。「需求中」「已上线」「已取消」必须保留。取消勾选时，处于该阶段的需求要迁移到其他阶段。</p>
      </div>
      {error ? (
        <div role="alert" className="banner-error" tabIndex={-1}>
          {error}
        </div>
      ) : null}
      <ul className="nv-stage-list" aria-label="需求阶段">
        {REQ_STATUS.map((s) => {
          const key = s.key as string;
          const locked = data.locked.includes(key);
          const on = !hidden.includes(key);
          const n = data.counts[key] || 0;
          const moving = needMove.includes(key);
          return (
            <li key={key} className={on ? "" : "is-off"}>
              <label className="nv-stage-check">
                <input type="checkbox" checked={on} disabled={locked || !data.canEdit || busy} onChange={(e) => toggle(key, e.target.checked)} />
                <span className="nv-stage-name">{s.label}</span>
                <span className="nv-stage-group">{STAGE_GROUP_LABEL[s.stage]}</span>
              </label>
              <span className="flex-1" />
              {locked ? <span className="nv-tag is-dot is-neutral">必须保留</span> : null}
              {moving ? (
                <span className="nv-stage-move">
                  {n} 条需求迁移到
                  <select className="input" value={migrate[key] || defaultTarget(key)} aria-label={`「${s.label}」的需求迁移到`} onChange={(e) => setMigrate((m) => ({ ...m, [key]: e.target.value }))}>
                    {enabled.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </span>
              ) : null}
              <span className="nv-stage-count">{n} 条</span>
            </li>
          );
        })}
      </ul>
      {data.canEdit ? (
        <div className="nv-stage-ops">
          <button type="button" className="btn-primary nv-head-btn" disabled={!dirty || busy} aria-busy={busy || undefined} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
          {dirty ? (
            <button type="button" className="btn-ghost nv-head-btn" disabled={busy} onClick={() => (setHidden(data.hidden), setMigrate({}))}>
              还原
            </button>
          ) : null}
        </div>
      ) : (
        <p className="nv-set-hint">只有管理员可以修改阶段</p>
      )}
    </div>
  );
}
