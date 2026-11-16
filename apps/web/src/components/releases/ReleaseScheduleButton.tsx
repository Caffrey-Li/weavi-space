"use client";

import { FormEvent, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import {
  DEFAULT_SCHEDULE,
  FREQUENCY_LABELS,
  WEEKDAY_NAMES,
  addDays,
  describeReleaseSchedule,
  fillPattern,
  nextOccurrences,
  normalizeSchedule,
  shanghaiToday,
  type ReleaseFrequency,
  type ReleaseScheduleConfig,
} from "@/lib/release-schedule-shared";

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const wd = (d: string) => WEEKDAY_NAMES[((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1];

/** 项目「固定发版」：配置发版节奏，按时间自动生成未来的发版计划 */
export function ReleaseScheduleButton({
  projectId,
  initial,
  className = "btn-secondary nv-head-btn",
}: {
  projectId: string;
  initial: ReleaseScheduleConfig | null;
  className?: string;
}) {
  const baseId = useId();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const start = initial || { ...DEFAULT_SCHEDULE, anchorDate: "" };
  const [v, setV] = useState<ReleaseScheduleConfig>(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [base, setBase] = useState(start);
  const errorRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ReleaseScheduleConfig>) => setV((x) => ({ ...x, ...patch }));

  const today = shanghaiToday();
  const preview = useMemo(() => {
    const cfg = normalizeSchedule({ ...v, anchorDate: v.anchorDate || today });
    if (typeof cfg === "string") return { error: cfg, rows: [] as { date: string; version: string; title: string; freeze: string }[] };
    return {
      error: "",
      rows: nextOccurrences(cfg, today, Math.max(cfg.horizon, 3)).map((d, i) => ({
        date: d,
        version: fillPattern(cfg.versionPattern, d, i + 1),
        title: cfg.titlePattern ? fillPattern(cfg.titlePattern, d, i + 1) : "",
        freeze: cfg.freezeDays ? addDays(d, -cfg.freezeDays) : "",
      })),
    };
  }, [v, today]);

  function show() {
    const s = initial || { ...DEFAULT_SCHEDULE, anchorDate: today };
    setBase(s);
    setV(s);
    setError("");
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cfg = normalizeSchedule({ ...v, anchorDate: v.frequency === "biweekly" ? v.anchorDate : "" });
    if (typeof cfg === "string") {
      setError(cfg);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/release-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; created?: number; removed?: number };
      if (!res.ok) {
        setError(data.error || "保存失败，输入已保留");
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setOpen(false);
      toast.success(`已设置固定发版：${describeReleaseSchedule(cfg)}${data.created ? `，生成 ${data.created} 个发版计划` : ""}`);
      router.refresh();
    } catch {
      setError("网络异常，结果未确认。请刷新核对后再决定是否重试。");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const ok = await confirm({
      title: "停用固定发版？",
      body: "不再自动生成新的发版计划。还没加需求、状态仍是规划中的未来计划会一并移除，已经在用的计划保留。",
      confirmLabel: "停用",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/release-schedule`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; removed?: number };
      if (!res.ok) {
        setError(data.error || "停用失败");
        return;
      }
      setOpen(false);
      toast.success(`已停用固定发版${data.removed ? `，移除 ${data.removed} 个未使用的计划` : ""}`);
      router.refresh();
    } catch {
      setError("网络异常，结果未确认。请刷新核对。");
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(v) !== JSON.stringify(base);

  return (
    <>
      <button type="button" className={className} onClick={show} title={initial?.enabled ? `固定发版：${describeReleaseSchedule(initial)}` : "设置固定发版节奏"}>
        <CalendarClock size={14} aria-hidden="true" />
        固定发版
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="固定发版计划" wide dirty={dirty} busy={busy}>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <p className="text-sm text-nv-text-secondary">
            按固定节奏自动生成发版计划，项目里始终保留未来几期，需求直接加入对应的期次即可。临时的线上问题用「紧急发版」处理，不受节奏限制。
          </p>
          {error ? (
            <div ref={errorRef} className="banner-error" role="alert" tabIndex={-1}>
              {error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <span className="text-sm font-medium" id={`${baseId}-freq`}>
              发版周期
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby={`${baseId}-freq`}>
              {(Object.keys(FREQUENCY_LABELS) as ReleaseFrequency[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={v.frequency === f}
                  className={`segmented-item${v.frequency === f ? " segmented-item-active" : ""}`}
                  onClick={() => set({ frequency: f, anchorDate: v.anchorDate || today })}
                >
                  {FREQUENCY_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {v.frequency === "monthly" ? (
              <Field id={`${baseId}-mday`} label="每月发版日">
                <select className="input" value={v.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d} 号
                    </option>
                  ))}
                  <option value={0}>月末最后一天</option>
                </select>
              </Field>
            ) : (
              <Field id={`${baseId}-wday`} label="发版日">
                <select className="input" value={v.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                  {WEEKDAY_NAMES.slice(1).map((n, i) => (
                    <option key={n} value={i + 1}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {v.frequency === "biweekly" ? (
              <Field id={`${baseId}-anchor`} label="第一次发版日期" hint="按这一天起每两周一次">
                <DatePicker id={`${baseId}-anchor`} value={v.anchorDate} clearable={false} onChange={(d) => set({ anchorDate: d })} />
              </Field>
            ) : null}
            <Field id={`${baseId}-time`} label="上线时间" hint="仅展示，不会自动改状态">
              <input className="input" type="time" value={v.releaseTime} onChange={(e) => set({ releaseTime: e.target.value })} />
            </Field>
            <Field id={`${baseId}-freeze`} label="提前冻结" hint="到期自动把计划改为「已冻结」，0 表示不自动冻结">
              <select className="input" value={v.freezeDays} onChange={(e) => set({ freezeDays: Number(e.target.value) })}>
                {[0, 1, 2, 3, 5, 7].map((n) => (
                  <option key={n} value={n}>
                    {n ? `上线前 ${n} 天` : "不自动冻结"}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-version`} label="版本号规则" required hint="占位符：{yyyy} {yy} {MM} {M} {dd} {d} 日期，{n} 期数">
              <input className="input" value={v.versionPattern} onChange={(e) => set({ versionPattern: e.target.value })} />
            </Field>
            <Field id={`${baseId}-title`} label="标题规则">
              <input className="input" value={v.titlePattern} onChange={(e) => set({ titlePattern: e.target.value })} placeholder="如 {M}月{d}日固定发版" />
            </Field>
            <Field id={`${baseId}-horizon`} label="提前生成" hint="项目里始终保留几期未来的发版计划">
              <select className="input" value={v.horizon} onChange={(e) => set({ horizon: Number(e.target.value) })}>
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    未来 {n} 期
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <section className="rounded-lg border border-nv-border-subtle p-3" aria-label="接下来的发版计划预览">
            <h3 className="mb-2 text-sm font-medium">
              接下来的发版<span className="ml-2 text-xs font-normal text-nv-text-secondary">{describeReleaseSchedule(v)}</span>
            </h3>
            {preview.error ? (
              <p className="text-sm text-nv-text-secondary">{preview.error}</p>
            ) : (
              <ul className="divide-y divide-nv-border-subtle text-sm">
                {preview.rows.map((r, i) => (
                  <li key={r.date} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5${i >= v.horizon ? " opacity-50" : ""}`}>
                    <span className="w-28 shrink-0 tabular-nums">
                      {md(r.date)} {wd(r.date)}
                    </span>
                    <span className="font-medium">v{r.version}</span>
                    {r.title ? <span className="text-nv-text-secondary">{r.title}</span> : null}
                    {r.freeze ? <span className="ml-auto text-xs text-nv-text-tertiary">{md(r.freeze)} 冻结</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-nv-text-tertiary">
              保存后立即生成前 {v.horizon} 期，之后每过一期自动补上下一期。修改节奏时，还没加需求的未来计划会按新节奏重建。
            </p>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {initial?.enabled ? (
              <button type="button" className="btn-ghost mr-auto text-nv-danger-fg" disabled={busy} onClick={() => void disable()}>
                停用固定发版
              </button>
            ) : null}
            <ModalCancelButton />
            <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
              {busy ? "保存中…" : initial?.enabled ? "保存并重新生成" : "启用固定发版"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
