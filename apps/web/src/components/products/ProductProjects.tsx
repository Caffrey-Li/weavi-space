"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Report = { id: string; weekStart: string; done: string; next: string; risks: string; progress: number | null; author: string; updatedAt: string };
type Proj = {
  id: string;
  name: string;
  key: string;
  iconUrl: string | null;
  progress: number;
  reqDone: number;
  reqAll: number;
  openBugs: number;
  plannedEndAt: string | null;
  canEdit: boolean;
  thisWeek: string;
  reports: Report[];
  schedule: { enabled: boolean; weekday: number; hour: number; lastSentAt: string | null };
};
const WEEKDAYS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 产品详情 · 项目（T17）：产品下各项目的进度和周报；周报可按本周数据起草，并可设置每周定时发给项目成员 */
export function ProductProjects({ projects }: { projects: Proj[] }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [editing, setEditing] = useState<{ p: Proj; weekStart: string; done: string; next: string; risks: string; progress: string } | null>(null);
  const [sched, setSched] = useState<{ p: Proj; enabled: boolean; weekday: number; hour: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen((o) => o ?? projects[0]?.id ?? null), [projects]);

  function edit(p: Proj, r?: Report) {
    setEditing({ p, weekStart: r?.weekStart || p.thisWeek, done: r?.done || "", next: r?.next || "", risks: r?.risks || "", progress: r?.progress === null || r?.progress === undefined ? "" : String(r.progress) });
  }
  async function draft() {
    if (!editing) return;
    const r = await fetch(`/api/projects/${editing.p.id}/reports/draft`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "起草失败");
    setEditing({ ...editing, done: d.done || "", next: d.next || "", risks: d.risks || "" });
    toast.success("已按本周数据起草，可以再修改");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    const r = await fetch(`/api/projects/${editing.p.id}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: editing.weekStart, done: editing.done, next: editing.next, risks: editing.risks, progress: editing.progress }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success("已保存周报");
    setEditing(null);
    router.refresh();
  }
  async function saveSched(e: React.FormEvent) {
    e.preventDefault();
    if (!sched || busy) return;
    setBusy(true);
    const r = await fetch(`/api/projects/${sched.p.id}/report-schedule`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sched) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success(sched.enabled ? `将在每${WEEKDAYS[sched.weekday]} ${sched.hour}:00 发给项目成员` : "已关闭定时发送");
    setSched(null);
    router.refresh();
  }

  if (!projects.length) return <div className="nv-page-body"><p className="nv-itr-empty">这个产品下还没有你能看到的项目。在项目设置里把项目关联到这个产品。</p></div>;
  return (
    <div className="nv-page-body">
      <div className="nv-set nv-pproj">
        {projects.map((p) => {
          const cur = p.reports.find((r) => r.weekStart === p.thisWeek);
          const expanded = open === p.id;
          return (
            <section key={p.id} className="nv-itr-card" aria-label={p.name}>
              <div className="nv-itr-head">
                <ProjectIcon name={p.name} src={p.iconUrl} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="nv-itr-title">
                    <Link href={`/projects/${p.id}`} className="nv-itr-title-text text-link">
                      {p.name}
                    </Link>
                    <code className="nv-ai-note">{p.key}</code>
                  </p>
                  <p className="nv-itr-sub">
                    需求 {p.reqDone}/{p.reqAll} 已上线 · 未关闭 Bug {p.openBugs}
                    {p.plannedEndAt ? ` · 计划 ${p.plannedEndAt.slice(0, 10)} 完成` : ""}
                    {p.schedule.enabled ? ` · 每${WEEKDAYS[p.schedule.weekday]} ${p.schedule.hour}:00 发周报` : ""}
                  </p>
                </div>
                <span className="nv-psum-progress">
                  <span className="nv-progress" aria-hidden="true">
                    <span style={{ width: `${p.progress}%` }} />
                  </span>
                  <span>{p.progress}%</span>
                </span>
              </div>
              <div className="nv-itr-status">
                <div className="min-w-0 flex-1">
                  <p className="nv-itr-status-title">{cur ? `本周周报 · ${cur.author} 更新于 ${cur.updatedAt.slice(5, 16).replace("T", " ")}` : "本周还没有写周报"}</p>
                </div>
                {p.canEdit ? (
                  <>
                    <button type="button" className="btn-primary nv-head-btn" onClick={() => edit(p, cur)}>
                      {cur ? "编辑本周周报" : "写本周周报"}
                    </button>
                    <button type="button" className="btn-secondary nv-head-btn" onClick={() => setSched({ p, ...p.schedule })}>
                      定时发送
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn-secondary nv-head-btn" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                  {expanded ? "收起" : `历史周报 ${p.reports.length}`}
                </button>
              </div>
              {expanded && p.reports.length ? (
                <ul className="nv-models-list nv-report-list">
                  {p.reports.map((r) => (
                    <li key={r.id} className="nv-models-item">
                      <div className="nv-models-item-main">
                        <b>{r.weekStart} 那周</b>
                        {r.progress !== null ? <span className="nv-tag is-info ml-1">进度 {r.progress}%</span> : null}
                        <span className="nv-ai-note"> · {r.author}</span>
                        {r.done ? <p className="whitespace-pre-line"><b>本周完成：</b>{r.done}</p> : null}
                        {r.next ? <p className="whitespace-pre-line"><b>下周计划：</b>{r.next}</p> : null}
                        {r.risks ? <p className="whitespace-pre-line"><b>风险：</b>{r.risks}</p> : null}
                      </div>
                      {p.canEdit ? (
                        <button type="button" className="text-link" onClick={() => edit(p, r)}>
                          编辑
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `${editing.p.name} · ${editing.weekStart} 那周的周报` : ""} busy={busy} panelClassName="nv-prod-modal">
        {editing ? (
          <form onSubmit={save} className="nv-pform" noValidate>
            <div className="nv-pform-body">
              <button type="button" className="btn-secondary nv-head-btn self-start" onClick={() => void draft()}>
                按本周数据起草
              </button>
              {(["done", "next", "risks"] as const).map((k) => (
                <label key={k} className="nv-pfield" htmlFor={`${id}-${k}`}>
                  <span className="nv-pfield-label">{k === "done" ? "本周完成" : k === "next" ? "下周计划" : "风险与问题"}</span>
                  <textarea id={`${id}-${k}`} className="input" rows={k === "done" ? 6 : 4} value={editing[k]} maxLength={5000} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                </label>
              ))}
              <label className="nv-pfield" htmlFor={`${id}-pg`}>
                <span className="nv-pfield-label">进度（%）</span>
                <input id={`${id}-pg`} className="input" inputMode="numeric" value={editing.progress} placeholder={`留空按已上线需求计算（${editing.p.progress}%）`} onChange={(e) => setEditing({ ...editing, progress: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
                保存
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={Boolean(sched)} onClose={() => setSched(null)} title={sched ? `定时发送周报 · ${sched.p.name}` : ""} busy={busy} panelClassName="nv-prod-modal nv-sm-modal">
        {sched ? (
          <form onSubmit={saveSched} className="nv-pform" noValidate>
            <div className="nv-pform-body">
              <p className="nv-pform-intro">到点把本周周报发给项目成员（站内通知；订阅了「项目周报」的人同时推到飞书机器人）。</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sched.enabled} onChange={(e) => setSched({ ...sched, enabled: e.target.checked })} />
                开启定时发送
              </label>
              <div className="nv-set-grid">
                <label className="nv-pfield" htmlFor={`${id}-wd`}>
                  <span className="nv-pfield-label">每周</span>
                  <select id={`${id}-wd`} className="input" value={sched.weekday} onChange={(e) => setSched({ ...sched, weekday: Number(e.target.value) })}>
                    {WEEKDAYS.slice(1).map((w, i) => (
                      <option key={w} value={i + 1}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nv-pfield" htmlFor={`${id}-hr`}>
                  <span className="nv-pfield-label">时间</span>
                  <select id={`${id}-hr`} className="input" value={sched.hour} onChange={(e) => setSched({ ...sched, hour: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">{sched.p.schedule.lastSentAt ? `上次发送 ${sched.p.schedule.lastSentAt.slice(0, 16).replace("T", " ")}` : ""}</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
                保存
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
