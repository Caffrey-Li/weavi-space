"use client";

import { Fragment, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { TrialButton } from "./TestStages";
import { PRIORITIES, STEP_ACTIONS, STEP_LABEL, stepText, toPlaywright, type StepAction, type TestCase, type TestStep } from "@pm-collab/core/shared/testcases";

/** 导出 Playwright：把结构化步骤转成 .spec.ts 下载 */
export function ExportPlaywrightButton({ cases, title }: { cases: TestCase[]; title: string }) {
  return (
    <button
      type="button"
      className="btn-secondary nv-head-btn"
      disabled={!cases.length}
      onClick={() => {
        const blob = new Blob([toPlaywright(cases, title)], { type: "text/typescript" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.replace(/[\\/:*?"<>|\s]+/g, "-") || "cases"}.spec.ts`;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download size={14} aria-hidden="true" />
      导出 Playwright
    </button>
  );
}

const PRI_TONE: Record<string, string> = { P0: "danger", P1: "warning", P2: "neutral", P3: "neutral" };
const blank: TestCase = { code: "", title: "", feature: "", priority: "P1", mode: "auto", precondition: "", steps: [{ action: "goto", target: "/", value: "" }], expected: "" };

/** 测试用例页：覆盖提示 + 用例表（展开看脚本步骤）+ 手动编辑 */
export function CasesView({
  cases,
  pageId,
  deliveryId,
  status,
  canEdit,
  coverage,
  basis,
}: {
  cases: TestCase[];
  pageId: string;
  deliveryId: string | null;
  status: string;
  canEdit: boolean;
  coverage: { total: number; covered: number; missing: string[] } | null;
  basis: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Set<string>>(() => new Set(cases.slice(0, 1).map((c) => c.code)));
  const [edit, setEdit] = useState<TestCase | null>(null);
  const editable = canEdit && !!deliveryId && status === "draft";

  const save = async (code: string, c: TestCase | null) => {
    const r = await fetch(`/api/deliveries/${deliveryId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveCase", code, case: c }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(d.error || "保存失败");
      return false;
    }
    toast.success(c ? "已保存" : "已删除");
    router.refresh();
    return true;
  };
  const toggle = (code: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  return (
    <div className="nv-cases">
      {basis ? <p className="nv-cases-basis">{basis}</p> : null}
      {coverage && coverage.total ? (
        coverage.missing.length ? (
          <p className="nv-cases-cov is-warn">
            覆盖 {coverage.covered} / {coverage.total} 个功能点 · {coverage.missing.join("、")} 还没有用例
            <span>在右侧「需求交付」里让小围补上</span>
          </p>
        ) : (
          <p className="nv-cases-cov">覆盖全部 {coverage.total} 个功能点</p>
        )
      ) : null}
      {status === "confirmed" ? <p className="nv-cases-note">用例已确认。要修改，先在「需求交付」面板里「重新打开」。可以在「需求交付」面板里发起测试。</p> : null}
      <div className="nv-cases-table" role="table" aria-label="测试用例">
        <div className="nv-cases-row is-head" role="row">
          <span role="columnheader" />
          <span role="columnheader">编号</span>
          <span role="columnheader">用例</span>
          <span role="columnheader">功能点</span>
          <span role="columnheader">优先级</span>
          <span role="columnheader">执行方式</span>
          <span role="columnheader">脚本</span>
          <span role="columnheader" />
        </div>
        {cases.length === 0 ? <p className="nv-cases-empty">还没有用例。</p> : null}
        {cases.map((c) => {
          const isOpen = open.has(c.code);
          return (
            <Fragment key={c.code}>
              <div className={`nv-cases-row${isOpen ? " is-open" : ""}`} role="row">
                <span role="cell">
                  <button type="button" className="icon-button" aria-expanded={isOpen} aria-label={isOpen ? "收起步骤" : "展开步骤"} onClick={() => toggle(c.code)}>
                    {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  </button>
                </span>
                <span role="cell" className="nv-cases-code">
                  {c.code}
                </span>
                <span role="cell" className="nv-cases-title">
                  {c.title}
                </span>
                <span role="cell">{c.feature || "—"}</span>
                <span role="cell">
                  <span className={`doc-chip tone-${PRI_TONE[c.priority]}`}>{c.priority}</span>
                </span>
                <span role="cell" className={c.mode === "manual" ? "nv-cases-manual" : undefined}>
                  {c.mode === "auto" ? "自动" : "手工"}
                </span>
                <span role="cell">{c.mode === "auto" ? `${c.steps.length} 步` : "—"}</span>
                <span role="cell" className="nv-cases-ops">
                  {editable ? (
                    <button type="button" className="text-link" onClick={() => setEdit(c)}>
                      编辑
                    </button>
                  ) : null}
                </span>
              </div>
              {isOpen ? (
                <div className="nv-cases-detail" role="row">
                  <div role="cell">
                    {c.precondition ? <p className="nv-cases-pre">前置条件：{c.precondition}</p> : null}
                    <ol className="nv-cases-steps">
                      {c.steps.map((s, i) => (
                        <li key={i}>{stepText(s)}</li>
                      ))}
                    </ol>
                    {c.expected ? <p className="nv-cases-pre">预期：{c.expected}</p> : null}
                    <div className="nv-cases-detail-foot">
                      {deliveryId && canEdit && c.mode === "auto" ? <TrialButton deliveryId={deliveryId} pageId={pageId} code={c.code} /> : null}
                      <span>结构化步骤，只会访问测试环境；试跑不提 Bug、不写测试记录</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      {editable ? (
        <button type="button" className="btn-secondary nv-head-btn nv-cases-add" onClick={() => setEdit({ ...blank })}>
          <Plus size={14} aria-hidden="true" />
          新增用例
        </button>
      ) : null}
      {edit ? (
        <CaseEditor
          value={edit}
          onClose={() => setEdit(null)}
          onSave={async (c) => {
            if (await save(edit.code, c)) setEdit(null);
          }}
          onDelete={
            edit.code
              ? async () => {
                  if (await confirm({ title: `删除 ${edit.code}？`, body: "删除后发布成新的一版，可以在版本记录里恢复。", confirmLabel: "删除", tone: "danger" })) {
                    if (await save(edit.code, null)) setEdit(null);
                  }
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function CaseEditor({ value, onClose, onSave, onDelete }: { value: TestCase; onClose: () => void; onSave: (c: TestCase) => Promise<void>; onDelete?: () => Promise<void> }) {
  const id = useId();
  const [c, setC] = useState<TestCase>(value);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TestCase>) => setC((x) => ({ ...x, ...patch }));
  const setStep = (i: number, patch: Partial<TestStep>) => set({ steps: c.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Modal open onClose={onClose} title={value.code ? `编辑 ${value.code}` : "新增用例"} wide busy={busy}>
      <div className="nv-case-form">
        <label className="nv-set-field" htmlFor={`${id}-t`}>
          用例标题
          <input id={`${id}-t`} className="input" value={c.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="nv-case-grid">
          <label className="nv-set-field" htmlFor={`${id}-f`}>
            功能点
            <input id={`${id}-f`} className="input" value={c.feature} placeholder="F-01" maxLength={10} onChange={(e) => set({ feature: e.target.value })} />
          </label>
          <label className="nv-set-field" htmlFor={`${id}-p`}>
            优先级
            <select id={`${id}-p`} className="input" value={c.priority} onChange={(e) => set({ priority: e.target.value as TestCase["priority"] })}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="nv-set-field" htmlFor={`${id}-m`}>
            执行方式
            <select id={`${id}-m`} className="input" value={c.mode} onChange={(e) => set({ mode: e.target.value as TestCase["mode"] })}>
              <option value="auto">自动</option>
              <option value="manual">手工</option>
            </select>
          </label>
        </div>
        <label className="nv-set-field" htmlFor={`${id}-pre`}>
          前置条件
          <input id={`${id}-pre`} className="input" value={c.precondition} maxLength={500} onChange={(e) => set({ precondition: e.target.value })} />
        </label>
        <fieldset className="nv-case-steps">
          <legend>步骤</legend>
          {c.steps.map((s, i) => (
            <div key={i} className="nv-case-step">
              <span className="nv-case-step-no">{i + 1}</span>
              <select className="input" aria-label={`第 ${i + 1} 步动作`} value={s.action} onChange={(e) => setStep(i, { action: e.target.value as StepAction })}>
                {STEP_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {STEP_LABEL[a]}
                  </option>
                ))}
              </select>
              <input className="input" aria-label={`第 ${i + 1} 步目标`} value={s.target} placeholder={s.action === "goto" ? "/login" : s.action === "wait" ? "" : "label=用户名 / role=button[name=登录] / text=…"} onChange={(e) => setStep(i, { target: e.target.value })} />
              <input className="input" aria-label={`第 ${i + 1} 步值`} value={s.value} placeholder={s.action === "wait" ? "秒数" : s.action === "fill" ? "{{username}}" : "值"} onChange={(e) => setStep(i, { value: e.target.value })} />
              <button type="button" className="icon-button" aria-label={`删除第 ${i + 1} 步`} onClick={() => set({ steps: c.steps.filter((_, j) => j !== i) })}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="text-link" onClick={() => set({ steps: [...c.steps, { action: "click", target: "", value: "" }] })}>
            + 加一步
          </button>
        </fieldset>
        <label className="nv-set-field" htmlFor={`${id}-e`}>
          预期结果
          <textarea id={`${id}-e`} className="input nv-set-textarea" rows={2} value={c.expected} maxLength={1000} onChange={(e) => set({ expected: e.target.value })} />
        </label>
      </div>
      <div className="nv-pform-foot">
        {onDelete ? (
          <button type="button" className="btn-secondary nv-head-btn is-danger" disabled={busy} onClick={() => void onDelete()}>
            删除
          </button>
        ) : null}
        <span className="nv-pform-note">保存后发布成新的一版</span>
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button
          type="button"
          className="btn-primary nv-head-btn"
          disabled={busy || !c.title.trim()}
          onClick={async () => {
            setBusy(true);
            await onSave(c).finally(() => setBusy(false));
          }}
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
