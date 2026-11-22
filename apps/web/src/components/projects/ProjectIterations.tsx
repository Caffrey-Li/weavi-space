"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { ReqStatusText } from "@/components/ui/ReqStatusText";
import { reqStatusLabel } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";

type Row = { id: string; code: string; title: string; status: string; priority: string; plannedEndAt: string | null; hours: number; risk: boolean };
type It = { id: string; name: string; goal: string | null; status: string; startAt: string; endAt: string; capacity: number | null; reqs: Row[]; online: number; hours: number; risks: number };
type Data = { iterations: It[]; backlog: Row[]; canEdit: boolean };

const md = (v: string) => fmtDate(v).slice(5);
const STATUS: Record<string, { label: string; tone: string }> = { planning: { label: "规划中", tone: "" }, active: { label: "进行中", tone: " tone-info" }, done: { label: "已完成", tone: " tone-success" } };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败");
  return d;
}

/** 项目 · 迭代（T43，Figma 89C） */
export function ProjectIterations({ projectId, data, scrum }: { projectId: string; data: Data; scrum: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const active = data.iterations.find((i) => i.status === "active") || null;
  const planning = data.iterations.filter((i) => i.status === "planning").sort((a, b) => a.startAt.localeCompare(b.startAt));
  const done = data.iterations.filter((i) => i.status === "done");
  const [focus, setFocus] = useState<string | null>(active?.id || planning[0]?.id || null);
  const cur = data.iterations.find((i) => i.id === focus) || active || planning[0] || null;
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const days = cur ? Math.max(0, Math.ceil((new Date(cur.endAt).getTime() - Date.now()) / 86400000) + 1) : 0;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      setPick([]);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const complete = async () => {
    if (!cur) return;
    const next = planning.find((p) => p.id !== cur.id);
    const left = cur.reqs.filter((r) => r.status !== "online" && r.status !== "cancelled").length;
    if (!(await confirm({ title: `完成${cur.name}？`, body: left ? `还有 ${left} 条需求没上线，会${next ? `挪到${next.name}` : "放回待规划"}。` : "所有需求都已上线或取消。", confirmLabel: "完成迭代" }))) return;
    await run(() => call(`/api/projects/${projectId}/iterations/${cur.id}`, "PATCH", { action: "complete", moveTo: next?.id ?? null }), `${cur.name}已完成`);
  };
  const pct = cur && cur.reqs.length ? Math.round((cur.online / cur.reqs.length) * 100) : 0;

  return (
    <>
      <header className="nv-overview-head">
        <div className="min-w-0">
          <h1 className="page-title">迭代</h1>
          <p className="page-summary">
            {scrum ? "按时间盒规划需求：先把需求池里的需求加入迭代，迭代结束时没上线的挪到下一期。" : "这个项目现在不是 Scrum 模式，迭代仍可以查看；要在看板上按迭代筛选，请在项目概览「研发流程」里改成 Scrum 迭代。"}
          </p>
        </div>
        {data.canEdit ? (
          <div>
            <button type="button" className="btn-primary nv-head-btn" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              新建迭代
            </button>
          </div>
        ) : null}
      </header>
      {data.iterations.length ? (
        <nav className="route-tabs" aria-label="迭代">
          {[...(active ? [active] : []), ...planning, ...done.slice(0, 6)].map((i) => (
            <button key={i.id} type="button" className={`route-tab${cur?.id === i.id ? " is-active" : ""}`} aria-current={cur?.id === i.id ? "page" : undefined} onClick={() => setFocus(i.id)}>
              {i.name}
              <span className={`nv-dl-tag${STATUS[i.status]?.tone || ""}`}>{STATUS[i.status]?.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {cur ? (
        <section className="page-section">
          <div className="nv-it-head">
            <h2 className="section-title">{cur.name}</h2>
            <span className="nv-flow-meta">
              {md(cur.startAt)} → {md(cur.endAt)}
              {cur.status === "active" ? ` · 还剩 ${days} 天` : ""}
            </span>
            <span className="nv-ra-spacer" />
            {data.canEdit && cur.status === "planning" && !active ? (
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void run(() => call(`/api/projects/${projectId}/iterations/${cur.id}`, "PATCH", { action: "start" }), `${cur.name}已开始`)}>
                开始迭代
              </button>
            ) : null}
            {data.canEdit && cur.status === "active" ? (
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void complete()}>
                完成迭代
              </button>
            ) : null}
          </div>
          {cur.goal ? <p className="nv-it-goal">目标：{cur.goal}</p> : null}
          <div className="kpi-grid nv-kpis-project">
            <div className="kpi-card">
              <span className="kpi-label">需求</span>
              <span className="kpi-value kpi-plain">{cur.reqs.length}</span>
              <span className="kpi-note">已上线 {cur.online}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">任务工时 / 容量</span>
              <span className="kpi-value kpi-plain">{cur.capacity ? `${cur.hours} / ${cur.capacity}` : cur.hours} h</span>
              <span className="kpi-note">{cur.capacity && cur.hours > cur.capacity ? "超出容量" : "按任务的预估工时汇总"}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">完成度</span>
              <span className="kpi-value kpi-plain">{pct}%</span>
              <span className="kpi-note">只算已上线</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">有风险</span>
              <span className="kpi-value kpi-plain">{cur.risks}</span>
              <span className="kpi-note">截止晚于迭代结束</span>
            </div>
          </div>
          <div className="nv-it-cols">
            <ReqList
              title="本迭代"
              rows={cur.reqs}
              action={data.canEdit && cur.status !== "done" ? { label: "移出", onClick: (ids) => void run(() => call(`/api/projects/${projectId}/iterations`, "POST", { action: "assign", iterationId: null, requirementIds: ids }), "已移出") } : null}
              pick={pick}
              setPick={setPick}
            />
            {cur.status !== "done" ? (
              <ReqList
                title="待规划（需求池）"
                rows={data.backlog}
                action={data.canEdit ? { label: `加入${cur.name}`, onClick: (ids) => void run(() => call(`/api/projects/${projectId}/iterations`, "POST", { action: "assign", iterationId: cur.id, requirementIds: ids }), `已加入${cur.name}`) } : null}
                pick={pick}
                setPick={setPick}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <div className="nv-ra-empty">还没有迭代。新建一个迭代（建议 1–4 周），再从需求池里把需求加进来。</div>
      )}
      {creating ? <NewIteration projectId={projectId} count={data.iterations.length} last={data.iterations[0] || null} onClose={() => setCreating(false)} onDone={() => (setCreating(false), router.refresh())} /> : null}
    </>
  );
}

function ReqList({ title, rows, action, pick, setPick }: { title: string; rows: Row[]; action: { label: string; onClick: (ids: string[]) => void } | null; pick: string[]; setPick: (v: string[]) => void }) {
  const mine = useMemo(() => pick.filter((id) => rows.some((r) => r.id === id)), [pick, rows]);
  return (
    <div className="card nv-it-list">
      <div className="nv-it-list-head">
        <b>{title}</b>
        <span className="nv-flow-meta">{rows.length}</span>
        <span className="nv-ra-spacer" />
        {action && mine.length ? (
          <button type="button" className="text-link" onClick={() => action.onClick(mine)}>
            {action.label}（{mine.length}）
          </button>
        ) : action ? (
          <span className="nv-flow-meta">勾选后{action.label}</span>
        ) : null}
      </div>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {action ? <input type="checkbox" aria-label={`选择 ${r.code}`} checked={pick.includes(r.id)} onChange={(e) => setPick(e.target.checked ? [...pick, r.id] : pick.filter((x) => x !== r.id))} /> : null}
              <span className="nv-mono">{r.code}</span>
              <Link href={`/requirements/${r.id}`} className="nv-it-title">
                {r.title}
              </Link>
              {r.risk ? <span className="nv-dl-tag tone-warn">截止 {r.plannedEndAt ? md(r.plannedEndAt) : ""}</span> : null}
              <span className="nv-flow-meta">
                <ReqStatusText statusKey={r.status} fallback={reqStatusLabel(r.status)} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nv-flow-meta nv-it-empty">没有需求</p>
      )}
    </div>
  );
}

function NewIteration({ projectId, count, last, onClose, onDone }: { projectId: string; count: number; last: It | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const startDefault = last ? new Date(new Date(last.endAt).getTime() + 86400000) : new Date();
  const iso = (d: Date) => fmtDate(d);
  const [v, setV] = useState({ name: `迭代 ${count + 1}`, goal: "", startAt: iso(startDefault), endAt: iso(new Date(startDefault.getTime() + 13 * 86400000)), capacity: "" });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const submit = async () => {
    setBusy(true);
    try {
      await call(`/api/projects/${projectId}/iterations`, "POST", { ...v, capacity: v.capacity || null });
      toast.success("已新建迭代");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="新建迭代" busy={busy}>
      <div className="nv-ra-form">
        <label className="nv-ra-field">
          <span className="nv-ra-label">名称</span>
          <input className="input" value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="nv-ra-field">
          <span className="nv-ra-label">目标（选填）</span>
          <input className="input" value={v.goal} maxLength={300} placeholder="这个迭代要交付什么" onChange={(e) => set({ goal: e.target.value })} />
        </label>
        <div className="nv-task-grid">
          <label className="nv-ra-field">
            <span className="nv-ra-label">开始</span>
            <input className="input" type="date" value={v.startAt} onChange={(e) => set({ startAt: e.target.value })} />
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">结束</span>
            <input className="input" type="date" value={v.endAt} onChange={(e) => set({ endAt: e.target.value })} />
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">容量（小时，选填）</span>
            <input className="input" inputMode="decimal" value={v.capacity} onChange={(e) => set({ capacity: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => void submit()}>
          新建
        </button>
      </div>
    </Modal>
  );
}
