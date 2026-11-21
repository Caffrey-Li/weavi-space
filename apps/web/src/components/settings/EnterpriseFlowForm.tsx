"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REQ_STATUS, STAGE_GROUP_LABEL } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { FLOW_LABEL_MAX, flowStatusLabel, labelConflict, type EnterpriseFlow } from "@pm-collab/core/shared/flow-config-shared";

type Data = {
  enterpriseId: string | null;
  enterprises: { id: string; name: string }[];
  flow?: EnterpriseFlow;
  systemHidden?: string[];
  locked?: string[];
  counts?: Record<string, number>;
  overrides?: { projectId: string; name: string; hidden: string[]; reviewRequired: boolean | null }[];
  canEdit: boolean;
  error?: string;
};

const ALL = REQ_STATUS.map((s) => s.key as string);

/** T41 企业研发流程：停用状态、改显示名称、是否必须评审、项目能否覆盖。系统超管可切换企业，企业超管只看本企业 */
export function EnterpriseFlowForm() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [ent, setEnt] = useState<string>("");
  const [data, setData] = useState<Data | null>(null);
  const [v, setV] = useState<EnterpriseFlow | null>(null);
  const [migrate, setMigrate] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(id: string) {
    setError("");
    const res = await fetch(`/api/flow/enterprise${id ? `?enterpriseId=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const d = res ? ((await res.json().catch(() => null)) as Data | null) : null;
    if (!res?.ok || !d) return setError(d?.error || "读取失败，请刷新重试");
    setData(d);
    setEnt(d.enterpriseId || "");
    setV(d.flow ? { ...d.flow, hidden: [...d.flow.hidden], labels: { ...d.flow.labels } } : null);
    setMigrate({});
  }
  useEffect(() => {
    void load("");
  }, []);

  if (!data) return <div className="nv-set">{error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>}</div>;

  const head = (
    <div className="nv-set-title">
      <h1>研发流程</h1>
      <p>企业的默认流程：用哪些状态、状态叫什么、需求是否必须评审通过才能进入开发。项目可以在企业允许的范围内单独调整。状态的含义和自动流转规则不变（例如「已上线」才算完成）。</p>
    </div>
  );
  if (!data.enterpriseId || !v || !data.flow) {
    return (
      <div className="nv-set">
        {head}
        <p className="nv-set-hint">{data.enterprises.length ? "请选择企业" : "当前账号不属于任何企业；没有企业的项目使用下方的系统默认阶段，不强制评审。"}</p>
      </div>
    );
  }

  const sys = data.systemHidden || [];
  const enabled = ALL.filter((k) => !sys.includes(k) && !v.hidden.includes(k));
  const needMove = v.hidden.filter((s) => !data.flow!.hidden.includes(s) && (data.counts?.[s] || 0) > 0);
  const target = (s: string) => migrate[s] || ALL.slice(ALL.indexOf(s) + 1).find((k) => enabled.includes(k) && k !== "cancelled") || enabled[0];
  const dirty = JSON.stringify(v) !== JSON.stringify(data.flow);
  const conflict = labelConflict(v.labels);
  const ro = !data.canEdit || busy;

  async function save() {
    if (!v || busy || !dirty || conflict) return;
    const moves = needMove.map((s) => ({ from: s, to: target(s), n: data!.counts?.[s] || 0 }));
    if (moves.length) {
      const ok = await confirm({
        title: "停用状态并迁移需求？",
        body: moves.map((m) => `「${flowStatusLabel(m.from, v.labels)}」的 ${m.n} 条需求会改为「${flowStatusLabel(m.to, v.labels)}」`).join("；") + "。每条都会记一条动态。",
        confirmLabel: "停用并迁移",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/flow/enterprise", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enterpriseId: data!.enterpriseId, ...v, migrate: Object.fromEntries(moves.map((m) => [m.from, m.to])) }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "保存失败，请重试");
    const n = ((d as { migrated?: { count: number }[] }).migrated || []).reduce((a, m) => a + m.count, 0);
    toast.success(n ? `已保存，${n} 条需求已迁移` : "已保存研发流程");
    await load(data!.enterpriseId!);
    router.refresh();
  }

  const set = (patch: Partial<EnterpriseFlow>) => setV((x) => (x ? { ...x, ...patch } : x));

  return (
    <div className="nv-set">
      {head}
      {data.enterprises.length <= 1 ? (
        <p className="mb-4 text-sm text-nv-text-secondary">企业：{data.enterprises.find((e) => e.id === ent)?.name || "本企业"}</p>
      ) : (
        <label className="mb-4 flex items-center gap-2 text-sm">
          企业
          <select className="input w-auto" value={ent} disabled={busy} onChange={(e) => void load(e.target.value)}>
            {data.enterprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error || conflict ? (
        <div role="alert" className="banner-error mb-4" tabIndex={-1}>
          {error || conflict}
        </div>
      ) : null}

      <section className="mb-6 space-y-2" aria-labelledby="ef-review">
        <h2 id="ef-review" className="text-base font-medium text-nv-text-primary">需求评审</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.reviewRequired} disabled={ro} onChange={(e) => set({ reviewRequired: e.target.checked })} />
          需求必须评审通过，才能从需求阶段进入开发 / 测试 / 上线
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.allowProjectReview} disabled={ro} onChange={(e) => set({ allowProjectReview: e.target.checked })} />
          允许项目单独开关评审
        </label>
        <p className="nv-set-hint">评审在需求详情里发起；所有评审人通过后，需求自动进入「{flowStatusLabel("req_done", v.labels)}」。</p>
      </section>

      <section className="mb-4 space-y-2" aria-labelledby="ef-stages">
        <h2 id="ef-stages" className="text-base font-medium text-nv-text-primary">状态</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.allowProjectStages} disabled={ro} onChange={(e) => set({ allowProjectStages: e.target.checked })} />
          允许项目在此基础上再停用状态
        </label>
        <ul className="nv-stage-list" aria-label="企业状态">
          {REQ_STATUS.map((s) => {
            const key = s.key as string;
            const bySystem = sys.includes(key);
            const locked = (data.locked || []).includes(key);
            const on = !bySystem && !v.hidden.includes(key);
            return (
              <li key={key} className={on ? "" : "is-off"}>
                <label className="nv-stage-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={ro || locked || bySystem}
                    onChange={(e) => set({ hidden: e.target.checked ? v.hidden.filter((x) => x !== key) : [...v.hidden, key] })}
                  />
                  <span className="nv-stage-group w-16 shrink-0">{STAGE_GROUP_LABEL[s.stage]}</span>
                </label>
                <input
                  className="input w-40"
                  value={v.labels[key] ?? ""}
                  placeholder={s.label}
                  maxLength={FLOW_LABEL_MAX}
                  disabled={ro}
                  aria-label={`「${s.label}」的显示名称`}
                  onChange={(e) => {
                    const labels = { ...v.labels };
                    const t = e.target.value;
                    if (t.trim() && t.trim() !== s.label) labels[key] = t;
                    else delete labels[key];
                    set({ labels });
                  }}
                />
                <span className="flex-1" />
                {locked ? <span className="nv-tag is-dot is-neutral">必须保留</span> : bySystem ? <span className="nv-tag is-dot is-neutral">系统已停用</span> : null}
                {needMove.includes(key) ? (
                  <span className="nv-stage-move">
                    {data.counts?.[key]} 条需求迁移到
                    <select className="input" value={target(key)} aria-label={`「${flowStatusLabel(key, v.labels)}」的需求迁移到`} onChange={(e) => setMigrate((m) => ({ ...m, [key]: e.target.value }))}>
                      {enabled.map((k) => (
                        <option key={k} value={k}>
                          {flowStatusLabel(k, v.labels)}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : null}
                {data.canEdit ? <span className="nv-stage-count">{data.counts?.[key] || 0} 条</span> : null}
              </li>
            );
          })}
        </ul>
        <p className="nv-set-hint">显示名称留空 = 用默认名称；最多 {FLOW_LABEL_MAX} 个字。改名只影响界面显示，导出、同步和动态记录仍用默认名称。</p>
      </section>

      {data.canEdit ? (
        <div className="nv-stage-ops">
          <button type="button" className="btn-primary nv-head-btn" disabled={!dirty || busy || Boolean(conflict)} aria-busy={busy || undefined} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
          {dirty ? (
            <button type="button" className="btn-ghost nv-head-btn" disabled={busy} onClick={() => (setV({ ...data.flow!, hidden: [...data.flow!.hidden], labels: { ...data.flow!.labels } }), setMigrate({}))}>
              还原
            </button>
          ) : null}
        </div>
      ) : (
        <p className="nv-set-hint">只有企业超管可以修改企业流程</p>
      )}

      {data.overrides?.length ? (
        <section className="mt-6 space-y-2" aria-labelledby="ef-overrides">
          <h2 id="ef-overrides" className="text-base font-medium text-nv-text-primary">单独设置过的项目</h2>
          <ul className="space-y-1 text-sm">
            {data.overrides.map((o) => (
              <li key={o.projectId}>
                <a className="text-link" href={`/projects/${o.projectId}`}>
                  {o.name}
                </a>
                <span className="text-nv-text-secondary">
                  {" "}
                  · {o.reviewRequired === null ? "评审跟随企业" : o.reviewRequired ? "必须评审" : "不强制评审"}
                  {o.hidden.length ? ` · 另停用 ${o.hidden.map((k) => flowStatusLabel(k, v.labels)).join("、")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
