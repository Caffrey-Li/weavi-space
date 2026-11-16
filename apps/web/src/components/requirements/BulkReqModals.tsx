"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { DatePicker } from "@/components/ui/DatePicker";
import { PRIORITY_LABELS, PRIORITY_OPTIONS, REQUIREMENT_ASSIGNEE_SLOTS, SEVERITY_LABELS, SEVERITY_OPTIONS } from "@/lib/constants";

type User = { id: string; name: string };
type Skip = { id: string; code: string; reason: string };
type Project = { id: string; name: string };

let metaCache: Promise<{ users: User[]; projects: Project[] }> | null = null;
function useMeta() {
  const [meta, setMeta] = useState<{ users: User[]; projects: Project[] } | null>(null);
  useEffect(() => {
    metaCache ||= fetch("/api/meta", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { users?: User[]; projects?: Project[] }) => ({ users: d.users || [], projects: d.projects || [] }))
      .catch(() => {
        metaCache = null;
        return { users: [], projects: [] };
      });
    let alive = true;
    void metaCache.then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, []);
  return meta;
}

/** 预检结果：可应用 N · 跳过 N（列出原因） */
function Precheck({ ok, skipped, loading, verb }: { ok: number | null; skipped: Skip[]; loading: boolean; verb: string }) {
  if (ok === null) return null;
  return (
    <div className="nv-bulk-check" aria-live="polite" aria-busy={loading || undefined}>
      <div className="nv-ftab-chips">
        <span className="nv-tag is-dot is-success">
          可{verb} {ok}
        </span>
        {skipped.length ? <span className="nv-tag is-dot is-warning">跳过 {skipped.length}</span> : null}
      </div>
      {skipped.length ? (
        <ul className="nv-bulk-skips">
          {skipped.slice(0, 8).map((s) => (
            <li key={s.id}>
              <b>{s.code}</b> {s.reason}
            </li>
          ))}
          {skipped.length > 8 ? <li>另有 {skipped.length - 8} 条…</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

const KEEP = "__keep__";
const CLEAR = "__clear__";

/** 需求批量设置（Figma 50）：负责人各槽位、开始日期、计划完成、优先级；「不修改」的字段保持原值 */
export function BulkEditModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (updated: number, skipped: Skip[]) => void }) {
  const meta = useMeta();
  const [people, setPeople] = useState<Record<string, string>>(() => Object.fromEntries(REQUIREMENT_ASSIGNEE_SLOTS.map((s) => [s.key, KEEP])));
  const [dateMode, setDateMode] = useState<Record<"startAt" | "plannedEndAt", string>>({ startAt: KEEP, plannedEndAt: KEEP });
  const [dates, setDates] = useState<Record<"startAt" | "plannedEndAt", string>>({ startAt: "", plannedEndAt: "" });
  const [priority, setPriority] = useState<string>(KEEP);
  const [check, setCheck] = useState<{ ok: number | null; skipped: Skip[] }>({ ok: null, skipped: [] });
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const patch = useMemo(() => {
    const p: { assignees?: Record<string, string | null>; startAt?: string | null; plannedEndAt?: string | null; priority?: string } = {};
    const a: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(people)) if (v !== KEEP) a[k] = v === CLEAR ? null : v;
    if (Object.keys(a).length) p.assignees = a;
    for (const k of ["startAt", "plannedEndAt"] as const) {
      if (dateMode[k] === CLEAR) p[k] = null;
      else if (dateMode[k] === "set" && dates[k]) p[k] = dates[k];
    }
    if (priority !== KEEP) p.priority = priority;
    return p;
  }, [people, dateMode, dates, priority]);
  const empty = !Object.keys(patch).length;

  // 改动后预检：哪些会被跳过
  useEffect(() => {
    if (empty) {
      setCheck({ ok: null, skipped: [] });
      return;
    }
    let alive = true;
    setChecking(true);
    const t = window.setTimeout(async () => {
      const res = await fetch("/api/requirements/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, patch, dryRun: true }) }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!alive) return;
      setChecking(false);
      if (!res?.ok) {
        setError((d as { error?: string }).error || "");
        setCheck({ ok: null, skipped: [] });
      } else {
        setError("");
        setCheck({ ok: (d as { ok: number }).ok, skipped: (d as { skipped: Skip[] }).skipped || [] });
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [ids, patch, empty]);

  async function apply() {
    if (empty || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/requirements/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, patch }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "保存失败，请重试");
    onDone((d as { updated: number }).updated, (d as { skipped: Skip[] }).skipped || []);
  }

  const userSelect = (slot: string, label: string) => (
    <label key={slot} className="nv-pfield" htmlFor={`bulk-${slot}`}>
      <span className="nv-pfield-label">{label}</span>
      <select id={`bulk-${slot}`} className="input" value={people[slot]} disabled={!meta} onChange={(e) => setPeople((p) => ({ ...p, [slot]: e.target.value }))}>
        <option value={KEEP}>不修改</option>
        <option value={CLEAR}>清空</option>
        {(meta?.users || []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
  const dateField = (k: "startAt" | "plannedEndAt", label: string) => (
    <div className="nv-pfield">
      <span className="nv-pfield-label" id={`bulk-${k}-l`}>
        {label}
      </span>
      <div className="nv-bulk-date">
        <select className="input" aria-labelledby={`bulk-${k}-l`} value={dateMode[k]} onChange={(e) => setDateMode((m) => ({ ...m, [k]: e.target.value }))}>
          <option value={KEEP}>不修改</option>
          <option value="set">设为</option>
          <option value={CLEAR}>清空</option>
        </select>
        {dateMode[k] === "set" ? <DatePicker value={dates[k]} onChange={(v) => setDates((d) => ({ ...d, [k]: v }))} ariaLabel={label} clearable={false} /> : null}
      </div>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`批量设置 · 已选 ${ids.length} 条需求`} busy={busy} dirty={!empty} panelClassName="nv-prod-modal nv-bulk-modal">
      <div className="nv-pform">
        <p className="nv-pform-intro">只修改改动过的字段，「不修改」的保持各条原值。负责人需是需求所属项目的成员，不满足的条目会跳过并列出。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <div className="nv-bulk-grid">{REQUIREMENT_ASSIGNEE_SLOTS.map((s) => userSelect(s.key, s.label))}</div>
          <div className="nv-bulk-grid">
            {dateField("startAt", "开始日期")}
            {dateField("plannedEndAt", "计划完成")}
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="bulk-prio">
              优先级
            </span>
            <div className="nv-pform-seg nv-newdoc-seg" role="group" aria-labelledby="bulk-prio">
              <button type="button" aria-pressed={priority === KEEP} onClick={() => setPriority(KEEP)}>
                不修改
              </button>
              {PRIORITY_OPTIONS.map((p) => (
                <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)}>
                  {p.toUpperCase()} {PRIORITY_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>
          <Precheck ok={check.ok} skipped={check.skipped} loading={checking} verb="应用" />
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">每条需求都会记一条动态</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="button" className="btn-primary nv-head-btn" disabled={empty || busy || checking || check.ok === 0} aria-busy={busy || undefined} onClick={() => void apply()}>
            {busy ? "保存中…" : empty ? "先选择要修改的字段" : `应用到 ${check.ok ?? ids.length} 条`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 需求移入 Bug（Figma 51）：严重程度、处理人、原需求处理方式；公共池需求要选目标项目 */
export function ToBugModal({
  ids,
  needProject,
  onClose,
  onDone,
}: {
  ids: string[];
  /** 选中的需求里有没有公共池（未归属项目）的 */
  needProject: boolean;
  onClose: () => void;
  onDone: (moved: number, keep: boolean, skipped: Skip[], movedIds: string[]) => void;
}) {
  const meta = useMeta();
  const [severity, setSeverity] = useState("major");
  const [owners, setOwners] = useState<{ frontend: string; backend: string }>({ frontend: "keep", backend: "keep" });
  const [keep, setKeep] = useState(false);
  const [project, setProject] = useState("");
  const [check, setCheck] = useState<{ ok: number | null; skipped: Skip[] }>({ ok: null, skipped: [] });
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const payload = useMemo(
    () => ({ ids, severity, frontend: owners.frontend, backend: owners.backend, keep, fallbackProjectId: project || undefined }),
    [ids, severity, owners, keep, project],
  );
  useEffect(() => {
    let alive = true;
    setChecking(true);
    void (async () => {
      const res = await fetch("/api/requirements/to-bugs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, dryRun: true }) }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!alive) return;
      setChecking(false);
      if (!res?.ok) setError((d as { error?: string }).error || "");
      else {
        setError("");
        setCheck({ ok: (d as { ok: number }).ok, skipped: (d as { skipped: Skip[] }).skipped || [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [payload]);

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/requirements/to-bugs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "移入失败，请重试");
    const created = (d as { created: { requirementId: string }[] }).created || [];
    onDone(created.length, keep, (d as { skipped: Skip[] }).skipped || [], created.map((c) => c.requirementId));
  }

  return (
    <Modal open onClose={onClose} title={`移入 Bug · 已选 ${ids.length} 条需求`} busy={busy} panelClassName="nv-prod-modal nv-bulk-modal">
      <div className="nv-pform">
        <p className="nv-pform-intro">把需求转成 Bug：标题、描述（含图片）、所属项目、产品模块和计划完成日期都会带过去。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="tobug-sev">
              严重程度
            </span>
            <div className="nv-pform-seg nv-newdoc-seg" role="group" aria-labelledby="tobug-sev">
              {SEVERITY_OPTIONS.map((s) => (
                <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)}>
                  {SEVERITY_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="nv-pfield">
            <div className="nv-bulk-grid">
              {(["frontend", "backend"] as const).map((k) => (
                <label key={k} className="nv-pfield" htmlFor={`tobug-${k}`}>
                  <span className="nv-pfield-label">{k === "frontend" ? "前端负责人" : "后端负责人"}</span>
                  <select id={`tobug-${k}`} className="input" value={owners[k]} onChange={(e) => setOwners((o) => ({ ...o, [k]: e.target.value }))}>
                    <option value="keep">沿用需求的{k === "frontend" ? "前端" : "后端"}负责人</option>
                    <option value="none">不指派</option>
                    {(meta?.users || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <span className="nv-set-hint">默认沿用需求里的前端 / 后端负责人，也可以「不指派」或指定成员；不是 Bug 所在项目成员时留空</span>
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="tobug-keep">
              原需求
            </span>
            <div className="nv-pform-seg nv-newdoc-seg" role="group" aria-labelledby="tobug-keep">
              <button type="button" aria-pressed={!keep} onClick={() => setKeep(false)}>
                移到回收站
              </button>
              <button type="button" aria-pressed={keep} onClick={() => setKeep(true)}>
                保留并关联
              </button>
            </div>
            <span className="nv-set-hint">{keep ? "需求留在需求池，Bug 关联到它" : "30 天内可以在「归档与回收站」恢复"}</span>
          </div>
          {needProject ? (
            <label className="nv-pfield" htmlFor="tobug-project">
              <span className="nv-pfield-label">没有项目的需求放到</span>
              <select id="tobug-project" className="input" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">选择项目…</option>
                {(meta?.projects || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="nv-set-hint">Bug 必须属于项目；公共池里的需求会放到这里</span>
            </label>
          ) : null}
          <Precheck ok={check.ok} skipped={check.skipped} loading={checking} verb="移入" />
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">移入后可在 Bug 列表查看</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="button" className="btn-primary nv-head-btn" disabled={busy || checking || !check.ok} aria-busy={busy || undefined} onClick={() => void apply()}>
            {busy ? "移入中…" : check.ok ? `移入 ${check.ok} 个 Bug` : "没有可移入的需求"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
