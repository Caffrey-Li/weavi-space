"use client";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { generateTitle } from "@/lib/title-gen-shared";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { DatePicker } from "@/components/ui/DatePicker";
import { buildProductTree, type ProductTreeNode } from "@/lib/products";
import {
  BUG_STATUS,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  jobRoleLabel,
  reqStatusLabel,
} from "@/lib/constants";

/** 环境选项（与新建 Bug 全页一致） */
export const BUG_ENV_OPTIONS = [
  { key: "production", label: "生产" },
  { key: "staging", label: "预发" },
  { key: "test", label: "测试" },
  { key: "dev", label: "开发" },
] as const;

export type BugFormValues = {
  title: string;
  summary: string;
  projectId: string;
  requirementId: string;
  severity: string;
  /** 前端负责人 / 后端负责人（处理人由服务端自动取后端 ?? 前端） */
  frontendId: string;
  backendId: string;
  status: string;
  /** 以下为新建 Bug 全页（Figma 28）的扩展字段，编辑时也能改 */
  dueAt: string;
  environment: string;
  device: string;
  foundVersion: string;
  docUrl: string;
  productId: string;
  productNodeId: string;
};

export const emptyBug = (projectId = "", requirementId = ""): BugFormValues => ({
  title: "",
  summary: "",
  projectId,
  requirementId,
  severity: "major",
  frontendId: "",
  backendId: "",
  status: "open",
  dueAt: "",
  environment: "",
  device: "",
  foundVersion: "",
  docUrl: "",
  productId: "",
  productNodeId: "",
});

type Member = { jobRole: string; user: { id: string; name: string } };

export function BugFormModal({
  open,
  mode,
  initial,
  initialOwnerNames,
  lockProject,
  onClose,
  onSubmit,
  footLead,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: BugFormValues;
  /** 编辑时原负责人的姓名：TA 可能已不是项目成员，仍要显示出来，避免保存时被悄悄清空 */
  /** 编辑时原负责人的名字（已不是项目成员时也能显示） */
  initialOwnerNames?: { frontend?: string | null; backend?: string | null };
  lockProject?: boolean;
  onClose: () => void;
  onSubmit: (v: BugFormValues) => Promise<string | null>;
  /** 页脚左侧的额外操作（编辑时的归档 / 删除） */
  footLead?: React.ReactNode;
}) {
  const baseId = useId();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ title?: string; project?: string }>({});
  const [projects, setProjects] = useState<{ id: string; name: string; key: string }[]>([]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [reqs, setReqs] = useState<{ id: string; title: string; status: string }[]>([]);
  const [releases, setReleases] = useState<{ id: string; version: string; title: string | null }[]>([]);
  const [products, setProducts] = useState<
    { id: string; name: string; code: string; nodes: { id: string; parentId: string | null; type: string; name: string; description: string | null; sortOrder: number }[] }[]
  >([]);
  const initialRef = useRef(initial);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    initialRef.current = initial;
    setValues(initial);
    // 值就绪后重新挂载编辑器，让它显示这次打开的描述（编辑器只在挂载时读初始内容）
    setEditorKey((k) => k + 1);
    setError("");
    setFieldErr({});
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProjects(d.projects || []))
      .catch(() => undefined);
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProducts(d.products || []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !values.projectId) {
      setMembers(null);
      setReqs([]);
      return;
    }
    let alive = true;
    Promise.all([
      fetch(`/api/projects/${values.projectId}/members`).then((r) => (r.ok ? r.json() : { members: [] })),
      fetch(`/api/requirements?projectId=${values.projectId}`).then((r) => (r.ok ? r.json() : { items: [] })),
      fetch(`/api/releases?projectId=${values.projectId}`).then((r) => (r.ok ? r.json() : { items: [] })),
    ])
      .then(([m, q, rel]) => {
        if (!alive) return;
        setMembers(m.members || []);
        setReqs(q.items || []);
        setReleases(rel.items || []);
      })
      .catch(() => {
        if (alive) {
          setMembers([]);
          setReqs([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [open, values.projectId]);

  const pool = useMemo(
    () => (members || []).map((m) => ({ id: m.user.id, name: m.user.name, jobRole: m.jobRole })),
    [members],
  );

  const dirty = JSON.stringify(values) !== JSON.stringify(initialRef.current);
  const productTree = useMemo(() => {
    const p = products.find((x) => x.id === values.productId);
    return p ? buildProductTree(p.nodes) : [];
  }, [products, values.productId]);
  const nodeOptions = useMemo(() => {
    const out: { id: string; label: string; pickable: boolean }[] = [];
    const walk = (l: ProductTreeNode[]) => l.forEach((n) => (out.push({ id: n.id, label: n.path.join(" › "), pickable: n.type !== "menu" }), walk(n.children)));
    walk(productTree);
    return out;
  }, [productTree]);
  const set = <K extends keyof BugFormValues>(k: K, v: BugFormValues[K]) => setValues((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fe: typeof fieldErr = {};
    let t = values.title.trim();
    // 没填标题时按描述自动生成
    if (!t && values.summary && values.projectId) {
      setBusy(true);
      t = (await generateTitle(values.summary, "bug")).title;
      setBusy(false);
      if (t) set("title", t);
    }
    if (!t) fe.title = "请填写 Bug 标题";
    if (!values.projectId) fe.project = "请选择所属项目";
    setFieldErr(fe);
    if (fe.title || fe.project) return;
    setBusy(true);
    setError("");
    try {
      const err = await onSubmit({ ...values, title: t });
      if (err) {
        setError(err);
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } catch {
      setError("网络异常，结果未确认。请稍后刷新核对，避免重复提交。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "提交 Bug" : "编辑 Bug"} wide dirty={dirty} busy={busy}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error ? (
          <div ref={errorRef} className="banner-error" role="alert" tabIndex={-1}>
            {error}
          </div>
        ) : null}
        <div className="nv-title-row nv-title-row-field">
          <Field id={`${baseId}-title`} label="标题" required error={fieldErr.title}>
            <input
              className="input"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="现象 + 场景，例如：导出 Excel 时日期列为空"
              data-initial-focus=""
              maxLength={200}
            />
          </Field>
          <GenTitleButton
            kind="bug"
            getHtml={() => values.summary}
            onTitle={(t) => {
              set("title", t);
              setFieldErr((p) => ({ ...p, title: undefined }));
            }}
          />
        </div>
        <Field id={`${baseId}-summary`} label="复现步骤 / 期望结果">
          <RichTextEditor
            key={`${mode}-${editorKey}`}
            ariaLabel="复现步骤 / 期望结果"
            variant="compact"
            toolbar="bottom"
            ownerType="bug"
            initialHtml={values.summary}
            placeholder="复现步骤、预期结果、实际结果；可直接粘贴截图"
            onChange={(html) => set("summary", html)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${baseId}-project`} label="所属项目" required error={fieldErr.project}>
            <select
              className="input"
              value={values.projectId}
              disabled={lockProject}
              onChange={(e) => setValues((p) => ({ ...p, projectId: e.target.value, requirementId: "", frontendId: "", backendId: "" }))}
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
          <Field id={`${baseId}-req`} label="关联需求" hint={values.projectId ? undefined : "先选项目"}>
            <select
              className="input"
              value={values.requirementId}
              disabled={!values.projectId}
              onChange={(e) => set("requirementId", e.target.value)}
            >
              <option value="">不关联</option>
              {values.requirementId && !reqs.some((r) => r.id === values.requirementId) ? (
                <option value={values.requirementId}>当前关联需求</option>
              ) : null}
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}（{reqStatusLabel(r.status)}）
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-sev`} label="严重级别">
            <select className="input" value={values.severity} onChange={(e) => set("severity", e.target.value)}>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          {(["frontend", "backend"] as const).map((kind) => {
            const key = kind === "frontend" ? "frontendId" : "backendId";
            const label = kind === "frontend" ? "前端负责人" : "后端负责人";
            // 推荐：前端负责人先列前端岗位，后端负责人先列后端 / 技术负责人
            const want = kind === "frontend" ? ["frontend"] : ["backend", "tech_lead"];
            const cur = values[key];
            return (
              <Field
                key={kind}
                id={`${baseId}-${kind}`}
                label={label}
                hint={values.projectId && members && members.length === 0 ? "该项目还没有成员" : undefined}
              >
                <select className="input" value={cur} disabled={!values.projectId} onChange={(e) => set(key, e.target.value)}>
                  <option value="">暂不指派</option>
                  {cur && !pool.some((u) => u.id === cur) ? (
                    <option value={cur}>
                      {(cur === initial[key] && initialOwnerNames?.[kind]) || "当前负责人"}（不是项目成员）
                    </option>
                  ) : null}
                  {pool.some((u) => want.includes(u.jobRole)) ? (
                    <optgroup label={kind === "frontend" ? "推荐 · 前端" : "推荐 · 后端 / 技术负责人"}>
                      {pool
                        .filter((u) => want.includes(u.jobRole))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {jobRoleLabel(u.jobRole)}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {pool.some((u) => !want.includes(u.jobRole)) ? (
                    <optgroup label="其他成员">
                      {pool
                        .filter((u) => !want.includes(u.jobRole))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {jobRoleLabel(u.jobRole)}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                </select>
              </Field>
            );
          })}
          {mode === "edit" ? (
            <Field id={`${baseId}-status`} label="状态">
              <select className="input" value={values.status} onChange={(e) => set("status", e.target.value)}>
                {BUG_STATUS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <details className="bug-more" open={mode === "edit" || undefined}>
          <summary>产品结构、环境与版本</summary>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${baseId}-product`} label="所属产品">
              <select
                className="input"
                value={values.productId}
                onChange={(e) => {
                  const v = e.target.value;
                  setValues((p) => ({ ...p, productId: v, productNodeId: "" }));
                }}
              >
                <option value="">不关联产品</option>
                {values.productId && !products.some((p) => p.id === values.productId) ? <option value={values.productId}>当前产品</option> : null}
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.code}）
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-node`} label="功能模块" hint={values.productId ? undefined : "先选产品"}>
              <select className="input" value={values.productNodeId} disabled={!values.productId} onChange={(e) => set("productNodeId", e.target.value)}>
                <option value="">不指定模块</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id} disabled={!n.pickable}>
                    {n.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-env`} label="环境">
              <select className="input" value={values.environment} onChange={(e) => set("environment", e.target.value)}>
                <option value="">未指定</option>
                {BUG_ENV_OPTIONS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}环境
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-device`} label="浏览器 / 设备">
              <input className="input" value={values.device} maxLength={80} placeholder="如 Chrome 130 · macOS" onChange={(e) => set("device", e.target.value)} />
            </Field>
            <Field id={`${baseId}-ver`} label="发现版本" hint={values.projectId ? undefined : "先选项目"}>
              <select className="input" value={values.foundVersion} disabled={!values.projectId} onChange={(e) => set("foundVersion", e.target.value)}>
                <option value="">未指定</option>
                {values.foundVersion && !releases.some((r) => r.version === values.foundVersion) ? (
                  <option value={values.foundVersion}>v{values.foundVersion.replace(/^v/i, "")}</option>
                ) : null}
                {releases.map((r) => (
                  <option key={r.id} value={r.version}>
                    v{r.version.replace(/^v/i, "")}
                    {r.title ? ` · ${r.title}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-due`} label="截止日期">
              <DatePicker value={values.dueAt} onChange={(v) => set("dueAt", v)} ariaLabel="截止日期" />
            </Field>
            <Field id={`${baseId}-link`} label="相关链接" hint="日志、监控、文档等，以 http(s):// 开头">
              <input className="input" type="url" value={values.docUrl} maxLength={500} placeholder="https://" onChange={(e) => set("docUrl", e.target.value)} />
            </Field>
          </div>
        </details>
        {values.projectId && members && members.length === 0 ? (
          <p className="text-xs text-neutral-500">
            <Link href={`/projects/${values.projectId}/members`} className="text-brand-600 hover:underline">
              去项目成员页按岗位加人
            </Link>
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          {footLead ? <div className="mr-auto flex gap-2">{footLead}</div> : null}
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
            {busy ? "提交中…" : mode === "create" ? "提交" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function bugPayload(v: BugFormValues, mode: "create" | "edit") {
  const out: Record<string, unknown> = {
    title: v.title.trim(),
    // 描述是富文本：summary 字段装的是 HTML，按 descriptionHtml 提交，服务端派生纯文本摘要
    descriptionHtml: v.summary || "",
    projectId: v.projectId || null,
    requirementId: v.requirementId || null,
    severity: v.severity,
    frontendId: v.frontendId || null,
    backendId: v.backendId || null,
    dueAt: v.dueAt || null,
    environment: v.environment || null,
    device: v.device,
    foundVersion: v.foundVersion,
    docUrl: v.docUrl || null,
    productId: v.productId || null,
    productNodeId: v.productNodeId || null,
  };
  if (mode === "edit") out.status = v.status;
  return out;
}
