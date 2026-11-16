"use client";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { DatePicker } from "@/components/ui/DatePicker";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  REQUIREMENT_ASSIGNEE_SLOTS,
  jobRoleLabel,
  normalizePriority,
} from "@/lib/constants";

type MetaUser = { id: string; name: string; email: string; globalRole: string; position?: string | null };
type MetaProject = { id: string; name: string; key: string };
type ProjectMember = { id: string; jobRole: string; user: { id: string; name: string; email: string; globalRole: string } };

export type RequirementFormValues = {
  title: string;
  summary: string;
  docUrl: string;
  projectId: string;
  priority: string;
  plannedEndAt: string; // yyyy-MM-dd
  assignees: Record<string, string>; // slot key -> userId
};

export const emptyRequirement = (projectId = ""): RequirementFormValues => ({
  title: "",
  summary: "",
  docUrl: "",
  projectId,
  priority: "p2",
  plannedEndAt: "",
  assignees: {},
});

function sameValues(a: RequirementFormValues, b: RequirementFormValues) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 新建 / 编辑需求共用表单。负责人按「岗位」槽位从项目成员里选：
 * 产品负责人优先产品/项目管理，前端负责人优先前端……其他成员放在「其他」分组。
 */
export function RequirementFormModal({
  open,
  mode,
  initial,
  lockProject,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: RequirementFormValues;
  lockProject?: boolean;
  onClose: () => void;
  /** 返回错误文案表示失败（表单保持打开并保留输入）；返回 null 表示成功 */
  onSubmit: (values: RequirementFormValues) => Promise<string | null>;
}) {
  const baseId = useId();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [titleError, setTitleError] = useState("");
  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [allUsers, setAllUsers] = useState<MetaUser[]>([]);
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initial);
  /** 只有用户主动换项目后才清理不在新项目里的负责人；打开编辑时保留历史数据原样 */
  const pruneAfterLoad = useRef(false);

  useEffect(() => {
    if (!open) return;
    initialRef.current = initial;
    setValues(initial);
    setError("");
    setTitleError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setProjects(data.projects || []);
        setAllUsers(data.users || []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const loadMembers = useCallback(async (pid: string) => {
    if (!pid) {
      setMembers(null);
      return;
    }
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/projects/${pid}/members`);
      const data = res.ok ? await res.json() : { members: [] };
      setMembers(data.members || []);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadMembers(values.projectId);
  }, [open, values.projectId, loadMembers]);

  const pool = useMemo(() => {
    if (values.projectId && members) {
      return members.map((m) => ({ id: m.user.id, name: m.user.name, jobRole: m.jobRole }));
    }
    return allUsers.map((u) => ({ id: u.id, name: u.name, jobRole: u.position || "member" }));
  }, [values.projectId, members, allUsers]);

  const dirty = !sameValues(values, initialRef.current);

  function set<K extends keyof RequirementFormValues>(key: K, v: RequirementFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function changeProject(pid: string) {
    // 换项目后，原负责人可能不是新项目成员：保留仍在新项目里的人，其余清空
    pruneAfterLoad.current = true;
    setMembers(null);
    setValues((prev) => ({ ...prev, projectId: pid }));
  }

  useEffect(() => {
    if (!members || !values.projectId || !pruneAfterLoad.current) return;
    pruneAfterLoad.current = false;
    const ids = new Set(members.map((m) => m.user.id));
    setValues((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev.assignees)) {
        if (v && ids.has(v)) next[k] = v;
        else if (v) changed = true;
      }
      return changed ? { ...prev, assignees: next } : prev;
    });
  }, [members, values.projectId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!values.title.trim()) {
      setTitleError("请填写需求标题");
      document.getElementById(`${baseId}-title`)?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const err = await onSubmit({ ...values, title: values.title.trim() });
      if (err) {
        setError(err);
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } catch {
      setError("网络异常，结果未确认。请稍后在列表中核对后再决定是否重试。");
    } finally {
      setBusy(false);
    }
  }

  const noMembers = Boolean(values.projectId) && members !== null && members.length === 0 && !membersLoading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "新建需求" : "编辑需求"}
      wide
      dirty={dirty}
      busy={busy}
    >
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="modal-form-fields">
          {error ? (
            <div ref={errorRef} className="banner-error" role="alert" tabIndex={-1}>
              {error}
            </div>
          ) : null}

          <div className="nv-title-row nv-title-row-field">
            <Field id={`${baseId}-title`} label="需求标题" required hint="用一句话描述需求" error={titleError}>
              <input
                className="input"
                value={values.title}
                onChange={(e) => {
                  set("title", e.target.value);
                  if (titleError && e.target.value.trim()) setTitleError("");
                }}
                placeholder="例如：导出报告支持按供应商筛选"
                data-initial-focus=""
                maxLength={200}
              />
            </Field>
            <GenTitleButton
              kind="requirement"
              getHtml={() => values.summary.replace(/\n/g, "<br>")}
              onTitle={(t) => {
                set("title", t);
                setTitleError("");
              }}
            />
          </div>

          <Field
            id={`${baseId}-project`}
            label="所属项目"
            hint={
              lockProject
                ? "在项目需求池中新建，归属已锁定为本项目"
                : "选项目后负责人从该项目成员中按岗位挑选；不选则留在公共池「未归属」"
            }
          >
            <select
              className="input"
              value={values.projectId}
              disabled={lockProject}
              onChange={(e) => changeProject(e.target.value)}
            >
              {!lockProject ? <option value="">公共池 · 暂不归属项目</option> : null}
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
          <Field id={`${baseId}-summary`} label="需求摘要" hint="背景、验收标准、注意事项">
            <textarea
              className="input min-h-[88px]"
              value={values.summary}
              onChange={(e) => set("summary", e.target.value)}
              rows={3}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id={`${baseId}-priority`} label="优先级">
              <select
                className="input"
                value={normalizePriority(values.priority)}
                onChange={(e) => set("priority", e.target.value)}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()} · {PRIORITY_LABELS[p].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${baseId}-due`} label="计划完成">
              <DatePicker id={`${baseId}-due`} value={values.plannedEndAt} onChange={(v) => set("plannedEndAt", v)} />
            </Field>
          </div>
          <Field id={`${baseId}-doc`} label="需求文档链接" hint="飞书文档等外链，仅保存链接">
            <input
              type="url"
              className="input"
              value={values.docUrl}
              onChange={(e) => set("docUrl", e.target.value)}
              placeholder="https://"
            />
          </Field>

          <fieldset className="rounded-lg border border-neutral-200 bg-nv-bg-subtle p-3">
            <legend className="px-1 text-sm font-medium text-neutral-800">按岗位指定负责人</legend>
            <p className="mb-3 text-xs text-neutral-500" aria-live="polite">
              {values.projectId
                ? membersLoading
                  ? "正在加载项目成员…"
                  : noMembers
                    ? "该项目还没有成员。"
                    : "每个槽位优先列出对应岗位的项目成员。"
                : "未归属项目时可从全部人员中选择；归属项目后只能选该项目成员。"}
              {noMembers ? (
                <>
                  {" "}
                  <Link href={`/projects/${values.projectId}/members`} className="text-brand-600 hover:underline">
                    去按岗位添加成员
                  </Link>
                </>
              ) : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {REQUIREMENT_ASSIGNEE_SLOTS.map((slot) => {
                const preferRoles = slot.preferRoles as readonly string[];
                const preferred = pool.filter((u) => preferRoles.includes(u.jobRole));
                const others = pool.filter((u) => !preferRoles.includes(u.jobRole));
                const currentId = values.assignees[slot.key] || "";
                const outsider =
                  currentId && !pool.some((u) => u.id === currentId)
                    ? allUsers.find((u) => u.id === currentId) || { id: currentId, name: "当前负责人", globalRole: "" }
                    : null;
                return (
                  <Field key={slot.key} id={`${baseId}-${slot.key}`} label={slot.label}>
                    <select
                      className="input"
                      value={values.assignees[slot.key] || ""}
                      disabled={noMembers}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, assignees: { ...prev.assignees, [slot.key]: e.target.value } }))
                      }
                    >
                      <option value="">未指定</option>
                      {outsider ? (
                        <option value={outsider.id}>
                          {outsider.name}（不是项目成员）
                        </option>
                      ) : null}
                      {preferred.length > 0 ? (
                        <optgroup label={`推荐 · ${preferRoles.map(jobRoleLabel).join("/")}`}>
                          {preferred.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} · {jobRoleLabel(u.jobRole)}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {others.length > 0 ? (
                        <optgroup label="其他成员">
                          {others.map((u) => (
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
            </div>
          </fieldset>

        </div>
        <div className="modal-form-actions">
          <p className="modal-form-note">带 * 为必填；提交失败时已填内容会保留。</p>
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spinner spinner-delayed" aria-hidden="true" /> : null}
            {busy ? (mode === "create" ? "创建中…" : "保存中…") : mode === "create" ? "创建需求" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 表单值 → API 请求体 */
export function requirementPayload(v: RequirementFormValues) {
  const assignees: Record<string, string | null> = {};
  for (const slot of REQUIREMENT_ASSIGNEE_SLOTS) assignees[slot.key] = v.assignees[slot.key] || null;
  return {
    title: v.title.trim(),
    summary: v.summary.trim() || null,
    docUrl: v.docUrl.trim() || null,
    projectId: v.projectId || null,
    priority: normalizePriority(v.priority),
    plannedEndAt: v.plannedEndAt || null,
    assignees,
  };
}
