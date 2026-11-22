"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

type Vote = { userId: string; name: string; avatarUrl: string | null; verdict: string; verdictLabel: string; comment: string | null; decidedAt: string | null; resolvedAt: string | null; resolvedBy: string | null; resolvedNote: string | null };
type Review = { id: string; round: number; title: string; note: string | null; status: string; statusLabel: string; docVersion: number | null; dueAt: string | null; overdue: boolean; createdAt: string; closedAt: string | null; creator: string; canCancel: boolean; canRemind: boolean; canResolve: boolean; pendingConditions: number; votes: Vote[]; myVote: string | null };
type Data = { canStart: boolean; enabled: boolean; reviewers: { id: string; name: string; avatarUrl: string | null }[]; title: string; reviews: Review[] };

const TONE: Record<string, string> = { open: "is-warning", approved: "is-success", rejected: "is-danger", cancelled: "is-neutral" };
const VOTE_TONE: Record<string, string> = { pending: "is-neutral", approve: "is-success", conditional: "is-warning", reject: "is-danger" };
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * T38 评审面板：需求详情和文档阅读页共用。显示当前（或最近一次）评审的评审人和结论；
 * 评审人在这里给结论；有编辑权限的人发起 / 取消。需求和它的主需求文档共用同一份评审记录。
 */
export function ReviewPanel({ requirementId, docPageId }: { requirementId?: string; docPageId?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const id = useId();
  const q = requirementId ? `requirementId=${encodeURIComponent(requirementId)}` : `docPageId=${encodeURIComponent(docPageId || "")}`;
  const [data, setData] = useState<Data | null>(null);
  const [starting, setStarting] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; avatarUrl: string | null }[]>([]);
  const [required, setRequired] = useState<string[]>([]);
  const [nextRound, setNextRound] = useState(1);
  const [resolving, setResolving] = useState<{ reviewId: string; userId: string; comment: string; note: string } | null>(null);
  const [form, setForm] = useState({ reviewerIds: [] as string[], dueAt: "", note: "" });
  const [voting, setVoting] = useState<{ verdict: string; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reviews?${q}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [q]);
  useEffect(() => {
    void load();
  }, [load]);

  async function openStart() {
    setError("");
    setForm({ reviewerIds: [], dueAt: "", note: "" });
    setStarting(true);
    const r = await fetch(`/api/reviews/candidates?${q}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setPeople(d.users || []);
    // T54：配置的评审人必须在内；重新提交时默认带上上一轮的评审人
    const req: string[] = d.required || [];
    setRequired(req);
    setNextRound(d.nextRound || 1);
    setForm((f) => ({ ...f, reviewerIds: Array.from(new Set([...req, ...((d.lastReviewers as string[]) || [])])) }));
  }

  async function start() {
    setBusy(true);
    setError("");
    const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(requirementId ? { requirementId } : { docPageId }), ...form }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error || "发起失败");
    setStarting(false);
    toast.success("已发起评审，评审人会收到通知");
    void load();
    router.refresh();
  }

  async function act(reviewId: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    const r = await fetch(`/api/reviews/${reviewId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      toast.error(d.error || "操作失败");
      return false;
    }
    toast.success(body.action === "vote" && d.status === "approved" ? "评审通过" : body.action === "vote" && d.status === "rejected" ? "已退回" : ok);
    void load();
    router.refresh();
    return true;
  }

  if (!data) return null;
  const current = data.reviews[0];
  const open = current?.status === "open" ? current : null;
  // T54：没启用评审、也没有评审记录就不显示
  if (!current && !data.enabled) return null;
  if (!current && !data.canStart && !data.enabled) return null;
  const list = showAll ? data.reviews : data.reviews.slice(0, 1);

  return (
    <section className="rv-panel" aria-labelledby={`${id}-t`}>
      <div className="rv-head">
        <ClipboardCheck size={16} aria-hidden="true" />
        <h2 id={`${id}-t`}>{requirementId ? "需求评审" : "文档评审"}</h2>
        <span className="flex-1" />
        {data.canStart && !open && data.reviewers.length ? (
          <button type="button" className={current?.status === "rejected" ? "btn-primary nv-head-btn" : "btn-secondary nv-head-btn"} onClick={() => void openStart()}>
            {current?.status === "rejected" ? "修改后重新提交" : current ? "再次发起评审" : "发起评审"}
          </button>
        ) : null}
      </div>
      {data.enabled && !data.reviewers.length ? <p className="rv-empty is-warn">本项目要求需求评审，但还没有配置评审人。请管理员在「研发流程」里设置默认评审岗位，或在项目流程里指定评审人。</p> : null}
      {!current && data.reviewers.length ? (
        <p className="rv-empty">
          还没有评审。评审人：{data.reviewers.map((x) => x.name).join("、")}。每人给出「通过 / 有条件通过 / 不通过」，有人不通过立即退回，全部通过后需求进入「需求完成」。
        </p>
      ) : null}
      {list.map((r) => (
        <div key={r.id} className="rv-card">
          <p className="rv-meta">
            <b className="rv-round">第 {r.round} 轮</b>
            <span className={`nv-tag is-dot ${r.pendingConditions ? "is-warning" : TONE[r.status] || "is-neutral"}`}>
              {r.pendingConditions ? `有条件通过 · 待落实 ${r.pendingConditions}` : r.status === "open" ? `${r.statusLabel} · ${r.votes.filter((v) => v.verdict !== "pending").length}/${r.votes.length} 已评` : r.statusLabel}
            </span>
            <span>
              {r.creator} {day(r.createdAt)} 发起{r.docVersion ? ` · 文档第 ${r.docVersion} 版` : ""}
              {r.dueAt ? ` · ${r.dueAt} 截止` : ""}
              {r.overdue ? <b className="rv-overdue"> · 已逾期</b> : null}
              {r.closedAt ? ` · ${day(r.closedAt)} 结束` : ""}
            </span>
          </p>
          {r.note ? <p className="rv-note">{r.note}</p> : null}
          <ul className="rv-votes">
            {r.votes.map((v) => (
              <li key={v.userId}>
                <Avatar name={v.name} src={v.avatarUrl} size={20} />
                <b>{v.name}</b>
                <span className={`nv-tag ${VOTE_TONE[v.verdict] || "is-neutral"}`}>{v.verdictLabel}</span>
                {v.comment ? <span className="rv-comment">{v.comment}</span> : null}
                {v.decidedAt ? <span className="rv-when">{day(v.decidedAt)}</span> : null}
                {v.verdict === "conditional" && r.status === "approved" ? (
                  v.resolvedAt ? (
                    <span className="rv-resolved" title={v.resolvedNote || undefined}>
                      已落实 · {v.resolvedBy} {day(v.resolvedAt)}
                      {r.canResolve ? (
                        <button type="button" className="text-link is-quiet" disabled={busy} onClick={() => void act(r.id, { action: "resolve", userId: v.userId, undo: true }, "已撤回")}>
                          撤回
                        </button>
                      ) : null}
                    </span>
                  ) : r.canResolve ? (
                    <button type="button" className="text-link" disabled={busy} onClick={() => setResolving({ reviewId: r.id, userId: v.userId, comment: v.comment || "", note: "" })}>
                      标记已落实
                    </button>
                  ) : (
                    <span className="nv-tag is-warning">待落实</span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          {r.status === "open" && (r.myVote || r.canCancel || r.canRemind) ? (
            <div className="rv-ops">
              {r.myVote ? (
                <>
                  <span className="rv-mine">{r.myVote === "pending" ? "请给出你的结论：" : "可以修改你的结论："}</span>
                  <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => void act(r.id, { action: "vote", verdict: "approve" }, "已提交")}>
                    通过
                  </button>
                  <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => setVoting({ verdict: "conditional", comment: "" })}>
                    有条件通过
                  </button>
                  <button type="button" className="btn-secondary nv-head-btn rv-reject" disabled={busy} onClick={() => setVoting({ verdict: "reject", comment: "" })}>
                    不通过
                  </button>
                </>
              ) : null}
              <span className="flex-1" />
              {r.canRemind ? (
                <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void act(r.id, { action: "remind" }, "已提醒还没评审的人")}>
                  催办
                </button>
              ) : null}
              {r.canCancel ? (
                <button
                  type="button"
                  className="btn-ghost nv-head-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirm({ title: "取消这次评审？", body: "已给出的结论会保留在记录里，需求状态不变。", confirmLabel: "取消评审", tone: "danger" })) await act(r.id, { action: "cancel" }, "已取消");
                  }}
                >
                  取消评审
                </button>
              ) : null}
            </div>
          ) : null}
          {voting && r.myVote ? (
            <Modal open onClose={() => setVoting(null)} title={voting.verdict === "reject" ? "不通过" : "有条件通过"} busy={busy} panelClassName="nv-prod-modal nv-sm-modal">
              <div className="nv-pform">
                <div className="nv-pform-body">
                  <label className="nv-pfield" htmlFor={`${id}-c`}>
                    <span className="nv-pfield-label">{voting.verdict === "reject" ? "不通过的原因" : "通过的条件"}</span>
                    <textarea id={`${id}-c`} className="input nv-set-textarea" rows={5} value={voting.comment} data-initial-focus="" placeholder={voting.verdict === "reject" ? "例如：缺少退款失败的处理流程" : "例如：上线前补充埋点方案"} onChange={(e) => setVoting({ ...voting, comment: e.target.value })} />
                  </label>
                </div>
                <div className="nv-pform-foot">
                  <span className="nv-pform-note">{voting.verdict === "reject" ? "提交后评审立即退回，并通知发起人和提出人" : ""}</span>
                  <ModalCancelButton className="btn-secondary nv-head-btn" />
                  <button
                    type="button"
                    className="btn-primary nv-head-btn"
                    disabled={busy || !voting.comment.trim()}
                    onClick={async () => {
                      if (await act(r.id, { action: "vote", verdict: voting.verdict, comment: voting.comment }, "已提交")) setVoting(null);
                    }}
                  >
                    提交
                  </button>
                </div>
              </div>
            </Modal>
          ) : null}
        </div>
      ))}
      {data.reviews.length > 1 ? (
        <button type="button" className="text-link is-quiet" onClick={() => setShowAll((x) => !x)}>
          {showAll ? "收起历史" : `查看历史评审（${data.reviews.length - 1}）`}
        </button>
      ) : null}

      {resolving ? (
        <Modal open onClose={() => setResolving(null)} title="标记条件已落实" busy={busy} panelClassName="nv-prod-modal nv-sm-modal">
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-pform-intro">条件：{resolving.comment}</p>
              <label className="nv-pfield" htmlFor={`${id}-rs`}>
                <span className="nv-pfield-label">怎么落实的（可选）</span>
                <textarea id={`${id}-rs`} className="input nv-set-textarea" rows={3} maxLength={500} value={resolving.note} placeholder="例如：已在 PRD 4.3 补充退款扣回规则" onChange={(e) => setResolving({ ...resolving, note: e.target.value })} />
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">会通知提条件的评审人</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button
                type="button"
                className="btn-primary nv-head-btn"
                disabled={busy}
                onClick={async () => {
                  if (await act(resolving.reviewId, { action: "resolve", userId: resolving.userId, note: resolving.note }, "已标记落实")) setResolving(null);
                }}
              >
                确认已落实
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <Modal open={starting} onClose={() => setStarting(false)} title={nextRound > 1 ? `发起第 ${nextRound} 轮评审` : "发起评审"} busy={busy} dirty={form.reviewerIds.length > 0 || Boolean(form.note)} panelClassName="nv-prod-modal nv-sm-modal">
        <div className="nv-pform">
          <p className="nv-pform-intro">评审「{data.title}」。每位评审人给出结论；有人不通过会立即退回，全部通过后需求进入「需求完成」{docPageId || requirementId ? "，主需求文档标为「评审通过」" : ""}。</p>
          <div className="nv-pform-body">
            {error ? (
              <div role="alert" className="banner-error">
                {error}
              </div>
            ) : null}
            <div className="nv-pfield">
              <span className="nv-pfield-label">评审人（{form.reviewerIds.length}）· 标「必选」的是研发流程配置的评审人，可以再加人</span>
              {people.length ? (
                <div className="nv-agents-perms rv-people">
                  {people.map((p) => (
                    <label key={p.id} title={required.includes(p.id) ? "研发流程里配置的评审人，必须参加" : undefined}>
                      <input type="checkbox" checked={form.reviewerIds.includes(p.id)} disabled={required.includes(p.id)} onChange={(e) => setForm({ ...form, reviewerIds: e.target.checked ? [...form.reviewerIds, p.id] : form.reviewerIds.filter((x) => x !== p.id) })} />
                      {p.name}
                      {required.includes(p.id) ? <span className="rv-req">必选</span> : null}
                    </label>
                  ))}
                </div>
              ) : (
                <span className="nv-pfield-hint">正在读取项目成员…</span>
              )}
            </div>
            <label className="nv-pfield" htmlFor={`${id}-due`}>
              <span className="nv-pfield-label">截止日期（可选）</span>
              <input id={`${id}-due`} type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </label>
            <label className="nv-pfield" htmlFor={`${id}-note`}>
              <span className="nv-pfield-label">评审要点（可选）</span>
              <textarea id={`${id}-note`} className="input nv-set-textarea" rows={4} value={form.note} maxLength={1000} placeholder="希望评审人重点看什么" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={busy || !form.reviewerIds.length} onClick={() => void start()}>
              {busy ? "发起中…" : "发起"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
