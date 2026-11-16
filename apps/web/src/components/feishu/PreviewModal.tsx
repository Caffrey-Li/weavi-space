"use client";

import { useEffect, useState } from "react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";

type Item = { kind: "create" | "update" | "skip" | "append"; row: string; title: string; detail: string };
type Plan = { direction: "pull" | "push"; counts: { create: number; update: number; same: number; skip: number; append: number }; items: Item[]; autoTitle?: boolean; canAutoTitle?: boolean };

const TAG: Record<Item["kind"], { label: string; tone: string }> = {
  create: { label: "新增", tone: "is-success" },
  append: { label: "追加", tone: "is-success" },
  update: { label: "更新", tone: "is-info" },
  skip: { label: "跳过", tone: "is-warning" },
};

/** Figma 38：拉取 / 回写前的变更预览，确认后执行 */
export function PreviewModal({ link, direction, onClose, onDone }: { link: { id: string; name: string; target?: string }; direction: "pull" | "push"; onClose: () => void; onDone: (msg: string) => void }) {
  const pull = direction === "pull";
  const noun = link.target === "bug" ? "Bug" : "需求";
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 标题来源：null = 按连接设置；切换后重新预览
  const [autoTitle, setAutoTitle] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await fetch(`/api/feishu-tables/${link.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, ...(autoTitle === null ? {} : { autoTitle }) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!alive) return;
      setLoading(false);
      if (!res.ok) setError(d.error || "读取失败");
      else {
        setError("");
        setPlan(d as Plan);
      }
    })();
    return () => {
      alive = false;
    };
  }, [link.id, direction, autoTitle]);

  const total = plan ? (pull ? plan.counts.create + plan.counts.update : plan.counts.update + plan.counts.append) : 0;

  async function apply() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/feishu-tables/${link.id}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction, apply: true, ...(plan?.canAutoTitle ? { autoTitle: Boolean(plan.autoTitle) } : {}) }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error || "同步失败");
    onDone(pull ? `已从飞书拉取：${d.message?.split("　")[1] || "完成"}` : `已回写飞书：${d.message?.split("　")[1] || "完成"}`);
  }

  const chips = plan
    ? pull
      ? [
          { label: `新增 ${plan.counts.create}`, tone: "is-success" },
          { label: `更新 ${plan.counts.update}`, tone: "is-info" },
          { label: `无变化 ${plan.counts.same}`, tone: "is-neutral" },
          { label: `跳过 ${plan.counts.skip}`, tone: "is-warning" },
        ]
      : [
          { label: `更新 ${plan.counts.update}`, tone: "is-info" },
          { label: `追加 ${plan.counts.append}`, tone: "is-success" },
          { label: `无变化 ${plan.counts.same}`, tone: "is-neutral" },
        ]
    : [];

  return (
    <Modal open onClose={onClose} title={`${pull ? "从飞书拉取" : "回写飞书"} · ${link.name}`} busy={busy} panelClassName="nv-prod-modal nv-ftab-preview">
      <div className="nv-pform">
        <p className="nv-pform-intro">
          {pull
            ? `以飞书为准：确认后按下列变更写入系统。表格里删掉的行不会删除系统中的${noun}。`
            : `以系统为准：确认后把下列内容写入飞书表格。系统里删除的${noun}不会删除表格中的行。`}
        </p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          {!plan && !error ? <p className="nv-set-hint">正在读取表格并比对…</p> : null}
          {plan && pull ? (
            <div className="nv-ftab-title-src">
              <span className="nv-pfield-label" id={`${link.id}-tsrc`}>
                标题
              </span>
              <div className="nv-pform-seg" role="group" aria-labelledby={`${link.id}-tsrc`}>
                <button type="button" aria-pressed={!plan.autoTitle} disabled={loading} onClick={() => setAutoTitle(false)}>
                  表格标题列
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(plan.autoTitle)}
                  disabled={loading || !plan.canAutoTitle}
                  title={plan.canAutoTitle ? "按描述提炼 20 字以内的标题" : "这个连接没有对应描述列，无法根据描述生成"}
                  onClick={() => setAutoTitle(true)}
                >
                  根据描述生成
                </button>
              </div>
              <span className="nv-set-hint">{plan.canAutoTitle ? "只影响本次拉取；连接里的默认设置不变" : "先在连接里为「描述」选择对应的列"}</span>
            </div>
          ) : null}
          {plan ? (
            <>
              <div className="nv-ftab-chips" aria-busy={loading || undefined}>
                {chips.map((c) => (
                  <span key={c.label} className={`nv-tag is-dot ${c.tone}`}>
                    {c.label}
                  </span>
                ))}
              </div>
              {plan.items.length ? (
                <ul className="nv-ftab-plan">
                  {plan.items.map((it, i) => (
                    <li key={`${it.row}-${i}`}>
                      <span className={`nv-tag is-dot ${TAG[it.kind].tone}`}>{TAG[it.kind].label}</span>
                      <span className="nv-ftab-plan-row">{it.row}</span>
                      <span className="nv-ftab-plan-main">
                        <b>{it.title}</b>
                        <small>{it.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="nv-itr-empty">两边内容一致，没有需要改动的地方。</p>
              )}
              {plan.counts.same && plan.items.length ? <p className="nv-set-hint">另有 {plan.counts.same} 行内容与{pull ? "系统" : "表格"}一致，不做改动</p> : null}
            </>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">{pull ? "回写飞书时同样先列出将改动的单元格，再确认" : `拉取时同样先列出将新建和更新的${noun}，再确认`}</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="button" className="btn-primary nv-head-btn" disabled={!plan || !total || busy || loading} aria-busy={busy || undefined} onClick={() => void apply()}>
            {busy ? "同步中…" : total ? `确认${pull ? "拉取" : "回写"} ${total} 条` : "没有需要改动的内容"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
