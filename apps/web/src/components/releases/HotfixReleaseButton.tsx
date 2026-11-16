"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Siren } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { BugStatusBadge, ReqStatusBadge } from "@/components/ui/StatusBadge";
import { shanghaiToday } from "@/lib/release-schedule-shared";

type BugOpt = { id: string; title: string; status: string; severity: string; environment: string | null };
type Req = { id: string; title: string; status: string };

export type HotfixValues = {
  projectId: string;
  version: string;
  title: string;
  reason: string;
  plannedAt: string;
  bugIds: string[];
  requirementIds: string[];
  startNow: boolean;
};

const SEVERITY: Record<string, string> = { blocker: "阻塞", critical: "严重", major: "一般", minor: "次要", trivial: "轻微" };
const ENV: Record<string, string> = { production: "线上", staging: "预发", test: "测试", dev: "开发" };

function HotfixModal({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: HotfixValues;
  onClose: () => void;
  onSubmit: (v: HotfixValues) => Promise<string | null>;
}) {
  const baseId = useId();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ project?: string; version?: string; reason?: string }>({});
  const [projects, setProjects] = useState<{ id: string; name: string; key: string }[]>([]);
  const [bugs, setBugs] = useState<BugOpt[] | null>(null);
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [baseVersion, setBaseVersion] = useState<string | null>(null);
  const initialRef = useRef(initial);
  const errorRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<HotfixValues>) => setV((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (!open) return;
    initialRef.current = initial;
    setV(initial);
    setError("");
    setFieldErr({});
    if (mode === "create") {
      fetch("/api/meta")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setProjects(d.projects || []))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !v.projectId) {
      setBugs(null);
      setReqs(null);
      return;
    }
    let alive = true;
    setBugs(null);
    setReqs(null);
    fetch(`/api/releases/hotfix?projectId=${v.projectId}`)
      .then((r) => (r.ok ? r.json() : { bugs: [] }))
      .then((d: { bugs?: BugOpt[]; suggestedVersion?: string; baseVersion?: string | null }) => {
        if (!alive) return;
        setBugs(d.bugs || []);
        setBaseVersion(d.baseVersion || null);
        if (mode === "create" && d.suggestedVersion) {
          setV((x) => (x.version ? x : { ...x, version: d.suggestedVersion! }));
          initialRef.current = { ...initialRef.current, projectId: v.projectId, version: d.suggestedVersion };
        }
      })
      .catch(() => alive && setBugs([]));
    fetch(`/api/requirements?projectId=${v.projectId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setReqs((d.items || []).filter((r: Req) => r.status !== "cancelled" && r.status !== "online")))
      .catch(() => alive && setReqs([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, v.projectId]);

  const bugSet = useMemo(() => new Set(v.bugIds), [v.bugIds]);
  const reqSet = useMemo(() => new Set(v.requirementIds), [v.requirementIds]);
  const toggle = (key: "bugIds" | "requirementIds", id: string) =>
    setV((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((i) => i !== id) : [...x[key], id] }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initialRef.current);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fe: typeof fieldErr = {};
    if (!v.projectId) fe.project = "请选择项目";
    if (!v.version.trim()) fe.version = "请填写版本号";
    if (!v.reason.trim()) fe.reason = "请说明要解决的线上问题";
    setFieldErr(fe);
    if (fe.project || fe.version || fe.reason) return;
    setBusy(true);
    setError("");
    try {
      const err = await onSubmit(v);
      if (err) {
        setError(err);
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } catch {
      setError("网络异常，结果未确认。请刷新核对后再决定是否重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "紧急发版" : "编辑紧急发版"} wide dirty={dirty} busy={busy}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {mode === "create" ? (
          <p className="text-sm text-nv-text-secondary">
            用于临时处理线上问题，不受固定发版节奏和冻结限制。勾选要修复的 Bug，上线时可以一并标记为已解决。
          </p>
        ) : null}
        {error ? (
          <div ref={errorRef} className="banner-error" role="alert" tabIndex={-1}>
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${baseId}-project`} label="项目" required error={fieldErr.project}>
            <select
              className="input"
              value={v.projectId}
              disabled={mode === "edit"}
              onChange={(e) => set({ projectId: e.target.value, version: "", bugIds: [], requirementIds: [] })}
            >
              <option value="">请选择项目</option>
              {v.projectId && !projects.some((p) => p.id === v.projectId) ? <option value={v.projectId}>当前项目</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.key}）
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={`${baseId}-version`}
            label="版本号"
            required
            error={fieldErr.version}
            hint={mode === "create" ? (baseVersion ? `基于最近上线的 v${baseVersion}` : "如 1.4.1-hotfix.1，不用写 v") : undefined}
          >
            <input className="input" value={v.version} onChange={(e) => set({ version: e.target.value })} />
          </Field>
          <Field id={`${baseId}-title`} label="标题">
            <input className="input" value={v.title} placeholder="如 修复支付回调超时" onChange={(e) => set({ title: e.target.value })} data-initial-focus="" />
          </Field>
          <Field id={`${baseId}-planned`} label="计划上线">
            <DatePicker id={`${baseId}-planned`} value={v.plannedAt} onChange={(d) => set({ plannedAt: d })} />
          </Field>
        </div>
        <Field id={`${baseId}-reason`} label="线上问题 / 发版原因" required error={fieldErr.reason}>
          <textarea
            className="input min-h-[72px]"
            rows={3}
            value={v.reason}
            placeholder="影响范围、发现时间、处理方案"
            onChange={(e) => set({ reason: e.target.value })}
          />
        </Field>

        <fieldset className="rounded-lg border border-nv-border-subtle p-3">
          <legend className="px-1 text-sm font-medium">
            修复的 Bug <span className="text-nv-text-secondary">已选 {v.bugIds.length}</span>
          </legend>
          {!v.projectId ? (
            <p className="text-sm text-nv-text-secondary">先选择项目。</p>
          ) : bugs === null ? (
            <p className="text-sm text-nv-text-secondary">正在加载该项目的 Bug…</p>
          ) : bugs.length === 0 ? (
            <p className="text-sm text-nv-text-secondary">该项目没有未关闭的 Bug，也可以不关联直接发版。</p>
          ) : (
            <ul className="max-h-56 divide-y divide-nv-border-subtle overflow-auto rounded-md border border-nv-border-subtle">
              {bugs.map((b) => (
                <li key={b.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-nv-bg-hover">
                    <input type="checkbox" checked={bugSet.has(b.id)} onChange={() => toggle("bugIds", b.id)} />
                    <span className="min-w-0 flex-1 truncate" title={b.title}>
                      {b.title}
                    </span>
                    {b.environment ? (
                      <span className={`badge ${b.environment === "production" ? "badge-danger" : "badge-neutral"}`}>{ENV[b.environment] || b.environment}</span>
                    ) : null}
                    <span className="badge badge-neutral">{SEVERITY[b.severity] || b.severity}</span>
                    <BugStatusBadge status={b.status} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {v.projectId && reqs && reqs.length ? (
          <details className="rounded-lg border border-nv-border-subtle p-3" open={v.requirementIds.length > 0}>
            <summary className="cursor-pointer text-sm font-medium">
              同时上线的需求（可选）<span className="ml-1 text-nv-text-secondary">已选 {v.requirementIds.length}</span>
            </summary>
            <ul className="mt-2 max-h-48 divide-y divide-nv-border-subtle overflow-auto rounded-md border border-nv-border-subtle">
              {reqs.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-nv-bg-hover">
                    <input type="checkbox" checked={reqSet.has(r.id)} onChange={() => toggle("requirementIds", r.id)} />
                    <span className="min-w-0 flex-1 truncate" title={r.title}>
                      {r.title}
                    </span>
                    <ReqStatusBadge status={r.status} />
                  </label>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {mode === "create" ? (
          <label className="flex items-start gap-2 rounded-md border border-nv-border-subtle bg-nv-bg-subtle p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={v.startNow} onChange={(e) => set({ startNow: e.target.checked })} />
            <span>
              创建后立即开始发布
              <span className="block text-xs text-nv-text-secondary">状态直接进入「发布中」，修复验证后在详情页点「标记上线」。</span>
            </span>
          </label>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
            {busy ? "保存中…" : mode === "create" ? (v.startNow ? "创建并开始发布" : "创建紧急发版") : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 新建紧急发版（发版列表页头） */
export function HotfixReleaseButton({ defaultProjectId, className = "btn-secondary nv-head-btn" }: { defaultProjectId?: string; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Siren size={14} aria-hidden="true" />
        紧急发版
      </button>
      <HotfixModal
        open={open}
        mode="create"
        initial={{
          projectId: defaultProjectId || "",
          version: "",
          title: "",
          reason: "",
          plannedAt: shanghaiToday(),
          bugIds: [],
          requirementIds: [],
          startNow: true,
        }}
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch("/api/releases/hotfix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
          if (!res.ok) return data.error || "创建失败，输入已保留";
          setOpen(false);
          toast.success(`已创建紧急发版 v${v.version.replace(/^v/i, "")}`);
          if (data.id) router.push(`/releases/${data.id}`);
          else router.refresh();
          return null;
        }}
      />
    </>
  );
}

/** 编辑紧急发版（详情页）：版本号、标题、原因、计划日期、修复的 Bug、同时上线的需求 */
export function EditHotfixButton({
  releaseId,
  values,
  frozen,
  className = "btn-secondary nv-head-btn",
}: {
  releaseId: string;
  values: Omit<HotfixValues, "startNow">;
  frozen?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Pencil size={14} aria-hidden="true" />
        编辑
      </button>
      <HotfixModal
        open={open}
        mode="edit"
        initial={{ ...values, startNow: false }}
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch(`/api/releases/${releaseId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              version: v.version,
              title: v.title,
              reason: v.reason,
              plannedAt: v.plannedAt,
              bugIds: v.bugIds,
              // 冻结期间需求集合不能变，原样提交
              requirementIds: frozen ? values.requirementIds : v.requirementIds,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) return data.error || "保存失败，输入已保留";
          setOpen(false);
          toast.success("已保存");
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
