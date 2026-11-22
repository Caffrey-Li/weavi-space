"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Workflow } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { REQ_STATUS, STAGE_GROUP_LABEL } from "@/lib/constants";
import { FLOW_MODES, GATE_DEFS, GATE_STAGES, flowStatusLabel, type FlowMode, type GateKey } from "@pm-collab/core/shared/flow-config-shared";

type Data = {
  inherited: { hidden: string[]; labels: Record<string, string>; reviewRequired: boolean; mode: FlowMode; designStage: boolean; gates: GateKey[]; reviewerRoles?: string[] };
  reviewers?: { id: string; name: string }[];
  members?: { id: string; name: string; position: string | null }[];
  allowStages: boolean;
  allowReview: boolean;
  allowMode: boolean;
  allowGates: boolean;
  own: { hidden: string[]; reviewRequired: boolean | null; mode: FlowMode | null; designStage: boolean | null; gates: GateKey[]; reviewerIds?: string[] };
  effective: { hidden: string[]; reviewRequired: boolean };
  locked: string[];
  counts: Record<string, number>;
  canEdit: boolean;
};

const ALL = REQ_STATUS.map((s) => s.key as string);

/** T41 项目研发流程：在企业流程基础上再停用状态、单独开关「必须评审」（企业允许时） */
export function ProjectFlowButton({ projectId, className = "btn-secondary nv-section-btn" }: { projectId: string; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [review, setReview] = useState<"inherit" | "on" | "off">("inherit");
  const [migrate, setMigrate] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<FlowMode | "">("");
  const [design, setDesign] = useState<"inherit" | "on" | "off">("inherit");
  const [gates, setGates] = useState<GateKey[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function show() {
    setOpen(true);
    setError("");
    setData(null);
    const res = await fetch(`/api/projects/${projectId}/flow`, { cache: "no-store" }).catch(() => null);
    const d = res ? ((await res.json().catch(() => null)) as Data | null) : null;
    if (!res?.ok || !d) return setError("读取失败，请重试");
    setData(d);
    setHidden(d.own.hidden);
    setReview(d.own.reviewRequired === null ? "inherit" : d.own.reviewRequired ? "on" : "off");
    setReviewerIds(d.own.reviewerIds || []);
    setMode(d.own.mode || "");
    setDesign(d.own.designStage === null ? "inherit" : d.own.designStage ? "on" : "off");
    setGates(d.own.gates || []);
    setMigrate({});
  }

  const labels = data?.inherited.labels || {};
  const enabled = data ? ALL.filter((k) => !data.inherited.hidden.includes(k) && !hidden.includes(k)) : [];
  const needMove = data ? hidden.filter((s) => !data.own.hidden.includes(s) && (data.counts[s] || 0) > 0) : [];
  const target = (s: string) => migrate[s] || ALL.slice(ALL.indexOf(s) + 1).find((k) => enabled.includes(k) && k !== "cancelled") || enabled[0];
  const reviewValue = review === "inherit" ? null : review === "on";
  const designValue = design === "inherit" ? null : design === "on";
  const dirty =
    Boolean(data) &&
    (JSON.stringify([...hidden].sort()) !== JSON.stringify([...data!.own.hidden].sort()) ||
      reviewValue !== data!.own.reviewRequired ||
      (mode || null) !== data!.own.mode ||
      designValue !== data!.own.designStage ||
      JSON.stringify([...gates].sort()) !== JSON.stringify([...(data!.own.gates || [])].sort()) ||
      JSON.stringify(reviewerIds) !== JSON.stringify(data!.own.reviewerIds || []));

  async function save() {
    if (!data || busy || !dirty) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { migrate: Object.fromEntries(needMove.map((s) => [s, target(s)])) };
    if (data.allowStages) body.hidden = hidden;
    if (data.allowReview) {
      body.reviewRequired = reviewValue;
      body.reviewerIds = reviewerIds;
    }
    if (data.allowMode) {
      body.mode = mode || null;
      body.designStage = designValue;
    }
    if (data.allowGates) body.gates = gates;
    const res = await fetch(`/api/projects/${projectId}/flow`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "保存失败，请重试");
    const n = ((d as { migrated?: { count: number }[] }).migrated || []).reduce((a, m) => a + m.count, 0);
    toast.success(n ? `已保存，${n} 条需求已迁移` : "已保存项目流程");
    setOpen(false);
    router.refresh();
  }

  const readOnly = !data?.canEdit;
  return (
    <>
      <button type="button" className={className} onClick={() => void show()}>
        <Workflow size={14} aria-hidden="true" />
        研发流程
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="项目研发流程" wide dirty={dirty} busy={busy}>
        <div className="space-y-4">
          <p className="text-sm text-nv-text-secondary">项目沿用企业的研发流程。企业允许时，项目可以再停用一些状态，或者单独决定需求是否必须评审通过才能进入开发。</p>
          {error ? (
            <div className="banner-error" role="alert" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          {!data ? (
            error ? null : <p className="nv-set-hint">正在读取…</p>
          ) : (
            <>
              <section aria-labelledby="pf-mode" className="space-y-2">
                <h3 id="pf-mode" className="text-sm font-medium text-nv-text-primary">研发模式和设计环节</h3>
                {data.allowMode ? (
                  <div className="flex flex-wrap gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      研发模式
                      <select className="input w-auto" value={mode} disabled={readOnly || busy} onChange={(e) => setMode(e.target.value as FlowMode | "")}>
                        <option value="">跟随企业（{FLOW_MODES.find((m) => m.key === data.inherited.mode)?.label}）</option>
                        {FLOW_MODES.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      设计环节
                      <select className="input w-auto" value={design} disabled={readOnly || busy} onChange={(e) => setDesign(e.target.value as "inherit" | "on" | "off")}>
                        <option value="inherit">跟随企业（{data.inherited.designStage ? "启用" : "不启用"}）</option>
                        <option value="on">启用「{flowStatusLabel("req_design", labels)}」</option>
                        <option value="off">不启用</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-nv-text-secondary">
                    企业统一为「{FLOW_MODES.find((m) => m.key === data.inherited.mode)?.label}」，设计环节{data.inherited.designStage ? "启用" : "不启用"}，项目不能单独修改。
                  </p>
                )}
                <p className="nv-set-hint">Scrum 迭代：项目多一个「迭代」标签，看板默认只看当前迭代。</p>
              </section>
              <section aria-labelledby="pf-gates" className="space-y-2">
                <h3 id="pf-gates" className="text-sm font-medium text-nv-text-primary">关卡</h3>
                <div className="nv-gate-table">
                  {GATE_STAGES.map((g) => (
                    <div key={g.key} className="nv-gate-row">
                      <b>{g.label}</b>
                      <div>
                        {GATE_DEFS.filter((d) => d.stage === g.key).map((d) => {
                          const fromEnt = data.inherited.gates.includes(d.key);
                          return (
                            <label key={d.key}>
                              <input
                                type="checkbox"
                                checked={fromEnt || gates.includes(d.key)}
                                disabled={readOnly || busy || fromEnt || !data.allowGates}
                                onChange={(e) => setGates((x) => (e.target.checked ? [...x, d.key] : x.filter((y) => y !== d.key)))}
                              />
                              {d.label}
                              {fromEnt ? "（企业）" : ""}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {!data.allowGates ? <p className="nv-set-hint">企业不允许项目再加关卡。</p> : null}
              </section>
              <section aria-labelledby="pf-review" className="space-y-2">
                <h3 id="pf-review" className="text-sm font-medium text-nv-text-primary">需求评审</h3>
                {data.allowReview ? (
                  <div className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby="pf-review">
                    {(
                      [
                        ["inherit", `跟随企业（${data.inherited.reviewRequired ? "必须评审" : "不强制评审"}）`],
                        ["on", "必须评审：评审通过后才能从需求阶段进入开发"],
                        ["off", "不强制评审"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2 text-sm">
                        <input type="radio" name="pf-review" checked={review === k} disabled={readOnly || busy} onChange={() => setReview(k)} />
                        {label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-nv-text-secondary">企业统一设置为{data.inherited.reviewRequired ? "「必须评审」" : "「不强制评审」"}，项目不能单独修改。</p>
                )}
                {(reviewValue ?? data.inherited.reviewRequired) ? (
                  <div className="nv-flow-reviewers">
                    <span className="text-sm">
                      评审人：{reviewerIds.length ? "本项目指定（代替企业默认岗位）" : `企业默认岗位的成员${data.reviewers?.length ? `（${data.reviewers.map((x) => x.name).join("、")}）` : "（本项目里没有，需要指定）"}`}
                    </span>
                    {data.allowReview && data.members?.length ? (
                      <div className="nv-flow-roles">
                        {data.members.map((m) => (
                          <label key={m.id} className="flex items-center gap-1 text-sm">
                            <input type="checkbox" checked={reviewerIds.includes(m.id)} disabled={readOnly || busy} onChange={(e) => setReviewerIds(e.target.checked ? [...reviewerIds, m.id] : reviewerIds.filter((x) => x !== m.id))} />
                            {m.name}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <p className="nv-set-hint">勾选成员 = 本项目指定评审人；都不勾 = 按企业默认评审岗位。启用评审后必须至少有一位评审人。</p>
                  </div>
                ) : null}
              </section>
              <section aria-labelledby="pf-stages" className="space-y-2">
                <h3 id="pf-stages" className="text-sm font-medium text-nv-text-primary">使用的状态</h3>
                {!data.allowStages ? <p className="text-sm text-nv-text-secondary">企业不允许项目单独停用状态，下面是企业的设置。</p> : null}
                <ul className="nv-stage-list" aria-label="项目状态">
                  {REQ_STATUS.filter((s) => s.key !== "req_design").map((s) => {
                    const key = s.key as string;
                    const fromAbove = data.inherited.hidden.includes(key);
                    const locked = data.locked.includes(key);
                    const on = !fromAbove && !hidden.includes(key);
                    const moving = needMove.includes(key);
                    return (
                      <li key={key} className={on ? "" : "is-off"}>
                        <label className="nv-stage-check">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={readOnly || busy || locked || fromAbove || !data.allowStages}
                            onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== key) : [...h, key]))}
                          />
                          <span className="nv-stage-name">{flowStatusLabel(key, labels)}</span>
                          <span className="nv-stage-group">{STAGE_GROUP_LABEL[s.stage]}</span>
                        </label>
                        <span className="flex-1" />
                        {locked ? <span className="nv-tag is-dot is-neutral">必须保留</span> : fromAbove ? <span className="nv-tag is-dot is-neutral">企业已停用</span> : null}
                        {moving ? (
                          <span className="nv-stage-move">
                            {data.counts[key]} 条需求迁移到
                            <select className="input" value={target(key)} aria-label={`「${flowStatusLabel(key, labels)}」的需求迁移到`} onChange={(e) => setMigrate((m) => ({ ...m, [key]: e.target.value }))}>
                              {enabled.map((k) => (
                                <option key={k} value={k}>
                                  {flowStatusLabel(k, labels)}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : null}
                        {data.canEdit ? <span className="nv-stage-count">{data.counts[key] || 0} 条</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {readOnly ? <span className="mr-auto text-sm text-nv-text-secondary">需要「编辑项目」权限才能修改</span> : null}
                <ModalCancelButton>{readOnly ? "关闭" : "取消"}</ModalCancelButton>
                {readOnly ? null : (
                  <button type="button" className="btn-primary" disabled={!dirty || busy} aria-busy={busy || undefined} onClick={() => void save()}>
                    {busy ? "保存中…" : "保存"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
