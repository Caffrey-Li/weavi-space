"use client";

import { DatePicker } from "@/components/ui/DatePicker";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ReqStatusBadge } from "@/components/ui/StatusBadge";

export type ReleaseFormValues = {
  projectId: string;
  version: string;
  title: string;
  plannedAt: string;
  description: string;
  requirementIds: string[];
};

type Req = { id: string; title: string; status: string };

function ReleaseFormModal({
  open,
  mode,
  initial,
  frozen,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: ReleaseFormValues;
  frozen?: boolean;
  onClose: () => void;
  onSubmit: (v: ReleaseFormValues) => Promise<string | null>;
}) {
  const baseId = useId();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ project?: string; version?: string }>({});
  const [projects, setProjects] = useState<{ id: string; name: string; key: string }[]>([]);
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [filter, setFilter] = useState("");
  const [hideOnline, setHideOnline] = useState(true);
  const initialRef = useRef(initial);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    initialRef.current = initial;
    setValues(initial);
    setError("");
    setFieldErr({});
    setFilter("");
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProjects(d.projects || []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !values.projectId) {
      setReqs(null);
      return;
    }
    let alive = true;
    setReqs(null);
    fetch(`/api/requirements?projectId=${values.projectId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setReqs((d.items || []).filter((r: Req) => r.status !== "cancelled")))
      .catch(() => alive && setReqs([]));
    return () => {
      alive = false;
    };
  }, [open, values.projectId]);

  const shown = useMemo(() => {
    const q = filter.trim();
    return (reqs || []).filter(
      (r) =>
        (!q || r.title.includes(q)) &&
        (!hideOnline || r.status !== "online" || values.requirementIds.includes(r.id)),
    );
  }, [reqs, filter, hideOnline, values.requirementIds]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initialRef.current);
  const selected = new Set(values.requirementIds);

  function toggle(id: string) {
    setValues((v) => ({
      ...v,
      requirementIds: v.requirementIds.includes(id) ? v.requirementIds.filter((x) => x !== id) : [...v.requirementIds, id],
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fe: typeof fieldErr = {};
    if (!values.projectId) fe.project = "请选择项目";
    if (!values.version.trim()) fe.version = "请填写版本号";
    setFieldErr(fe);
    if (fe.project || fe.version) return;
    setBusy(true);
    setError("");
    try {
      const err = await onSubmit(values);
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
    <Modal open={open} onClose={onClose} title={mode === "create" ? "新建发版" : "编辑发版"} wide dirty={dirty} busy={busy}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error ? (
          <div ref={errorRef} className="banner-error" role="alert" tabIndex={-1}>
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${baseId}-project`} label="项目" required error={fieldErr.project}>
            <select
              className="input"
              value={values.projectId}
              disabled={mode === "edit"}
              onChange={(e) => setValues((v) => ({ ...v, projectId: e.target.value, requirementIds: [] }))}
            >
              <option value="">请选择项目</option>
              {values.projectId && !projects.some((p) => p.id === values.projectId) ? (
                <option value={values.projectId}>当前项目</option>
              ) : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.key}）
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-version`} label="版本号" required error={fieldErr.version} hint="如 1.4.0，不用写 v">
            <input
              className="input"
              value={values.version}
              onChange={(e) => setValues((v) => ({ ...v, version: e.target.value }))}
              data-initial-focus=""
            />
          </Field>
          <Field id={`${baseId}-title`} label="版本标题">
            <input className="input" value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} />
          </Field>
          <Field id={`${baseId}-planned`} label="计划上线">
            <DatePicker id={`${baseId}-planned`} value={values.plannedAt} onChange={(d) => setValues((v) => ({ ...v, plannedAt: d }))} />
          </Field>
        </div>
        <Field id={`${baseId}-desc`} label="说明">
          <textarea
            className="input min-h-[64px]"
            rows={2}
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          />
        </Field>

        <fieldset className="rounded-lg border border-neutral-200 p-3" disabled={frozen}>
          <legend className="px-1 text-sm font-medium">
            关联需求 <span className="text-neutral-500">已选 {values.requirementIds.length}</span>
          </legend>
          {frozen ? <p className="mb-2 text-xs text-neutral-500">版本已冻结，需先解除冻结才能调整关联需求。</p> : null}
          {!values.projectId ? (
            <p className="text-sm text-neutral-500">先选择项目，再勾选要随本版本上线的需求。</p>
          ) : reqs === null ? (
            <p className="text-sm text-neutral-500">正在加载该项目的需求…</p>
          ) : reqs.length === 0 ? (
            <p className="text-sm text-neutral-500">该项目还没有可加入的需求。</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <input
                  className="input max-w-[240px]"
                  placeholder="按标题过滤"
                  aria-label="按标题过滤需求"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={hideOnline} onChange={(e) => setHideOnline(e.target.checked)} />
                  隐藏已上线
                </label>
              </div>
              <ul className="max-h-64 divide-y divide-neutral-100 overflow-auto rounded-md border border-neutral-100">
                {shown.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      <span className="min-w-0 flex-1 truncate" title={r.title}>
                        {r.title}
                      </span>
                      <ReqStatusBadge status={r.status} />
                    </label>
                  </li>
                ))}
                {shown.length === 0 ? <li className="px-3 py-3 text-sm text-neutral-500">没有匹配的需求</li> : null}
              </ul>
            </>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
            {busy ? "保存中…" : mode === "create" ? "创建发版" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewReleaseButton({
  defaultProjectId,
  className = "btn-primary",
  label = "新建版本",
}: {
  defaultProjectId?: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {className.includes("nv-head-btn") ? null : <Plus size={16} aria-hidden="true" />}
        {label}
      </button>
      <ReleaseFormModal
        open={open}
        mode="create"
        initial={{ projectId: defaultProjectId || "", version: "", title: "", plannedAt: "", description: "", requirementIds: [] }}
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch("/api/releases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return (data as { error?: string }).error || "创建失败，输入已保留";
          setOpen(false);
          const id = (data as { id?: string }).id;
          toast.show({
            tone: "success",
            message: `已创建发版 v${v.version.replace(/^v/i, "")}`,
            action: id ? { label: "查看", onClick: () => router.push(`/releases/${id}`) } : undefined,
          });
          router.refresh();
          return null;
        }}
      />
    </>
  );
}

export function EditReleaseButton({
  releaseId,
  values,
  frozen,
  className = "btn-secondary",
}: {
  releaseId: string;
  values: ReleaseFormValues;
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
        编辑 / 选需求
      </button>
      <ReleaseFormModal
        open={open}
        mode="edit"
        frozen={frozen}
        initial={values}
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch(`/api/releases/${releaseId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return (data as { error?: string }).error || "保存失败，输入已保留";
          setOpen(false);
          const d = data as { added?: number; removed?: number };
          toast.success(d.added || d.removed ? `已保存，关联需求 +${d.added} / -${d.removed}` : "已保存");
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
