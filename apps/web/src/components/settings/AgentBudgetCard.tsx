"use client";

import { useEffect, useId, useState } from "react";
import { useToast } from "@/components/ui/Toast";

type Budget = {
  enterpriseId: string;
  enterpriseName: string;
  maxSteps: number;
  maxTokens: number;
  maxActive: number;
  ruleRunsPerDay: number;
  allowRules: boolean;
  runsToday: number;
  monthTokens: number;
  range: Record<"maxSteps" | "maxTokens" | "maxActive" | "ruleRunsPerDay", [number, number]>;
};
type Form = { maxSteps: string; maxTokens: string; maxActive: string; ruleRunsPerDay: string; allowRules: boolean };
const FIELDS: { key: "maxSteps" | "maxTokens" | "maxActive" | "ruleRunsPerDay"; label: string }[] = [
  { key: "maxSteps", label: "每个任务最多步数" },
  { key: "maxTokens", label: "每个任务最多 token" },
  { key: "maxActive", label: "每人同时进行的任务" },
  { key: "ruleRunsPerDay", label: "自动化规则每天最多运行（全企业）" },
];
const toForm = (b: Budget): Form => ({ maxSteps: String(b.maxSteps), maxTokens: String(b.maxTokens), maxActive: String(b.maxActive), ruleRunsPerDay: String(b.ruleRunsPerDay), allowRules: b.allowRules });

/** 模型管理 · 小围动手预算（T27 二期，Figma「81」105）：企业超管调整本企业的 Agent 上限 */
export function AgentBudgetCard({ enterpriseId }: { enterpriseId: string }) {
  const toast = useToast();
  const id = useId();
  const [b, setB] = useState<Budget | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/agent-budget?enterprise=${encodeURIComponent(enterpriseId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.budget) return;
        setB(d.budget);
        setF(toForm(d.budget));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enterpriseId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    try {
      const r = await fetch("/api/ai/agent-budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId, ...Object.fromEntries(FIELDS.map((x) => [x.key, Number(f[x.key])])), allowRules: f.allowRules }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(d.error || "保存失败");
      setB(d.budget);
      setF(toForm(d.budget));
      toast.success("已保存，新发起的任务按新预算执行");
    } finally {
      setBusy(false);
    }
  }

  if (!b || !f) return null;
  return (
    <section className="nv-set-section" aria-labelledby={`${id}-h`}>
      <header>
        <h2 id={`${id}-h`}>小围动手预算 · {b.enterpriseName}</h2>
        <p>对{b.enterpriseName}的所有成员生效，用企业模型和个人模型都按这里限制。全系统同时最多运行 3 个任务。</p>
      </header>
      <form className="nv-set-form" onSubmit={save} noValidate>
        <div className="nv-agt-grid nv-agt-budget">
          {FIELDS.map((x) => (
            <label key={x.key} className="nv-set-field" htmlFor={`${id}-${x.key}`}>
              {x.label}
              <input
                id={`${id}-${x.key}`}
                className="input"
                type="number"
                inputMode="numeric"
                min={b.range[x.key][0]}
                max={b.range[x.key][1]}
                value={f[x.key]}
                onChange={(e) => setF({ ...f, [x.key]: e.target.value })}
              />
              <small>
                {b.range[x.key][0].toLocaleString()}～{b.range[x.key][1].toLocaleString()}
              </small>
            </label>
          ))}
        </div>
        <label className="nv-switch">
          <input type="checkbox" checked={f.allowRules} onChange={(e) => setF({ ...f, allowRules: e.target.checked })} />
          <span aria-hidden="true" />
          允许成员建自动化规则
        </label>
        <p className="nv-set-hint">
          今天：自动化规则已运行 {b.runsToday} / {b.ruleRunsPerDay} 次 · 本月小围动手 {b.monthTokens.toLocaleString()} token（企业模型的用量另计入成员 token 定额）
        </p>
        <div>
          <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </section>
  );
}
