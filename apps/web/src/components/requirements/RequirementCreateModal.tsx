"use client";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { generateTitle } from "@/lib/title-gen-shared";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, MoreHorizontal, Rocket, UserRound } from "lucide-react";
import Link from "next/link";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { FloatingPop } from "@/components/ui/FloatingPop";
import { DatePicker } from "@/components/ui/DatePicker";
import { Avatar } from "@/components/ui/Avatar";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { PriorityGlyph, REQ_GLYPH } from "@/components/ui/Glyphs";
import { PRIORITY_LABELS, PRIORITY_OPTIONS, REQUIREMENT_ASSIGNEE_SLOTS, jobRoleLabel } from "@/lib/constants";
import { emptyRequirement, requirementPayload, type RequirementFormValues } from "./RequirementForm";

type MetaProject = { id: string; name: string; key: string; iconUrl?: string | null };
type MetaUser = { id: string; name: string; globalRole: string; position?: string | null; avatarUrl?: string | null };
type MetaRelease = { id: string; version: string; title?: string | null; projectId: string };
type Member = { id: string; jobRole: string; user: MetaUser };

export type RequirementCreateValues = RequirementFormValues & { releaseId: string; itrNo: string };

/** 属性胶囊 + 下拉（浮层挂在弹窗层上，按屏幕空间上下翻，不会被弹窗裁掉） */
function PropPicker({
  label,
  icon,
  active,
  disabled,
  title,
  width = 200,
  children,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="nv-prop-wrap">
      <button
        ref={anchor}
        type="button"
        className={`nv-prop${active ? " is-set" : ""}`}
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>
      <FloatingPop anchorRef={anchor} open={open} onClose={close} width={width} className="nv-prop-pop" role="listbox">
        {children(close)}
      </FloatingPop>
    </div>
  );
}

/**
 * 新建需求（Figma 12）：顶部选项目，正文是大标题 + 描述，
 * 下方一行属性胶囊（状态 / 优先级 / 负责人 / 截止日期 / 发版 / ITR 单号 / 更多），底部「继续新建」。
 */
export function RequirementCreateModal({
  open,
  defaultProjectId = "",
  lockProject = false,
  fullHref,
  onClose,
  onSubmit,
}: {
  /** 「展开为全页」 */
  fullHref?: string;
  open: boolean;
  defaultProjectId?: string;
  lockProject?: boolean;
  onClose: () => void;
  /** 返回错误文案表示失败；返回 null 表示成功 */
  onSubmit: (values: RequirementCreateValues, keepOpen: boolean) => Promise<string | null>;
}) {
  const baseId = useId();
  const blank = (pid: string): RequirementCreateValues => ({ ...emptyRequirement(pid), releaseId: "", itrNo: "" });
  const [values, setValues] = useState<RequirementCreateValues>(blank(defaultProjectId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keepOpen, setKeepOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [users, setUsers] = useState<MetaUser[]>([]);
  const [releases, setReleases] = useState<MetaRelease[]>([]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const title = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setValues(blank(defaultProjectId));
    setError("");
    setMore(false);
    let alive = true;
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setProjects(d.projects || []);
        setUsers(d.users || []);
        setReleases(d.releases || []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !values.projectId) {
      setMembers(null);
      return;
    }
    let alive = true;
    fetch(`/api/projects/${values.projectId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => alive && setMembers(d.members || []))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [open, values.projectId]);

  const pool = useMemo(
    () =>
      values.projectId && members
        ? members.map((m) => ({ id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl, jobRole: m.jobRole }))
        : users.map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobRole: u.position || "member" })),
    [values.projectId, members, users],
  );
  const project = projects.find((p) => p.id === values.projectId);
  const projectReleases = releases.filter((r) => r.projectId === values.projectId);
  const release = projectReleases.find((r) => r.id === values.releaseId);
  const ownerId = values.assignees.product || "";
  const owner = pool.find((u) => u.id === ownerId) || users.find((u) => u.id === ownerId);
  const dirty = Boolean(values.title || values.summary || values.plannedEndAt || values.releaseId || values.itrNo || Object.values(values.assignees).some(Boolean));

  function set<K extends keyof RequirementCreateValues>(key: K, v: RequirementCreateValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }
  function changeProject(pid: string) {
    // 换项目：负责人和版本都按新项目重新选
    setValues((prev) => ({ ...prev, projectId: pid, releaseId: "", assignees: {} }));
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    let t = values.title.trim();
    setBusy(true);
    // 没填标题时按描述自动生成
    if (!t && values.summary) {
      t = (await generateTitle(values.summary, "requirement")).title;
      if (t) setValues((prev) => ({ ...prev, title: t }));
    }
    if (!t) {
      setBusy(false);
      setError("请填写需求标题");
      title.current?.focus();
      return;
    }
    if (!values.projectId) {
      setBusy(false);
      setError("请选择所属项目");
      return;
    }
    setError("");
    try {
      const err = await onSubmit({ ...values, title: t }, keepOpen);
      if (err) setError(err);
      else if (keepOpen) {
        // 连续录入：保留项目 / 版本 / 负责人，清空标题与描述
        setValues((prev) => ({ ...prev, title: "", summary: "", itrNo: "" }));
        setEditorKey((k) => k + 1);
        title.current?.focus();
      }
    } catch {
      setError("网络异常，结果未确认。请稍后在列表中核对后再决定是否重试。");
    } finally {
      setBusy(false);
    }
  }

  const ReqIcon = REQ_GLYPH["req_in_progress"];
  const pri = values.priority;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建需求"
      dirty={dirty}
      busy={busy}
      panelClassName="nv-create-modal"
      headLead={
        <PropPicker
          disabled={lockProject}
          title={lockProject ? "在项目内新建，归属已锁定" : "选择项目"}
          icon={project ? <ProjectIcon name={project.name} src={project.iconUrl} size={16} /> : null}
          label={
            <>
              <span className="nv-prop-text">{project?.name || "选择项目"}</span>
              {lockProject ? null : <ChevronDown size={12} aria-hidden="true" />}
            </>
          }
          width={240}
        >
          {(close) => (
            <>
              {projects.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={p.id === values.projectId} onClick={() => (changeProject(p.id), close())}>
                  <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                  {p.name}
                </button>
              ))}
            </>
          )}
        </PropPicker>
      }
    >
      <form className="nv-create" onSubmit={submit} noValidate>
        <div className="nv-create-body">
          <div className="nv-title-row">
          <textarea
            ref={title}
            id={`${baseId}-title`}
            className="nv-create-title"
            rows={1}
            value={values.title}
            maxLength={200}
            placeholder="需求标题"
            aria-label="需求标题（必填）"
            aria-invalid={error === "请填写需求标题" || undefined}
            data-initial-focus=""
            onChange={(e) => {
              set("title", e.target.value.replace(/\n/g, ""));
              if (error === "请填写需求标题") setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey)) void submit();
              else if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
            }}
          />
          <GenTitleButton
            kind="requirement"
            getHtml={() => values.summary}
            onTitle={(t) => {
              set("title", t);
              if (error === "请填写需求标题") setError("");
            }}
          />
          </div>
          <RichTextEditor
            key={editorKey}
            ariaLabel="需求描述"
            variant="compact"
            toolbar="bottom"
            className="nv-create-rt"
            placeholder="补充背景、目标与验收标准，可直接粘贴截图…"
            onChange={(html) => set("summary", html)}
            onSubmit={() => void submit()}
          />

          {more ? (
            <div className="nv-create-more">
              <label>
                <span>需求文档链接</span>
                <input type="url" className="input" value={values.docUrl} placeholder="https://" onChange={(e) => set("docUrl", e.target.value)} />
              </label>
              {REQUIREMENT_ASSIGNEE_SLOTS.map((slot) => (
                <label key={slot.key}>
                  <span>{slot.label}</span>
                  <select
                    className="input"
                    value={values.assignees[slot.key] || ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, assignees: { ...prev.assignees, [slot.key]: e.target.value } }))}
                  >
                    <option value="">未指定</option>
                    {pool.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {jobRoleLabel(u.jobRole)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="nv-create-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="nv-create-props" role="group" aria-label="需求属性">
            <span className="nv-prop is-static" title="新需求从「需求中」开始">
              <ReqIcon size={14} aria-hidden="true" />
              需求中
            </span>
            <PropPicker icon={<PriorityGlyph priority={pri} />} label={`${pri.toUpperCase()} ${PRIORITY_LABELS[pri]?.label || ""}`} active width={160}>
              {(close) =>
                PRIORITY_OPTIONS.map((p) => (
                  <button key={p} type="button" role="option" aria-selected={p === pri} onClick={() => (set("priority", p), close())}>
                    <PriorityGlyph priority={p} />
                    {p.toUpperCase()} · {PRIORITY_LABELS[p].label}
                  </button>
                ))
              }
            </PropPicker>
            <PropPicker
              icon={owner ? <Avatar name={owner.name} src={owner.avatarUrl} size={14} /> : <UserRound size={14} aria-hidden="true" />}
              label={owner?.name || "负责人"}
              active={Boolean(owner)}
              title="产品负责人；其他岗位在「…」里指定"
              width={220}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!ownerId} onClick={() => (setValues((prev) => ({ ...prev, assignees: { ...prev.assignees, product: "" } })), close())}>
                    未指定
                  </button>
                  {pool.length === 0 ? <p className="nv-prop-empty">{values.projectId ? "该项目还没有成员" : "正在加载…"}</p> : null}
                  {pool.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      role="option"
                      aria-selected={u.id === ownerId}
                      onClick={() => (setValues((prev) => ({ ...prev, assignees: { ...prev.assignees, product: u.id } })), close())}
                    >
                      <Avatar name={u.name} src={u.avatarUrl} size={16} />
                      {u.name}
                      <small>{jobRoleLabel(u.jobRole)}</small>
                    </button>
                  ))}
                </>
              )}
            </PropPicker>
            <DatePicker
              variant="pill"
              value={values.plannedEndAt}
              onChange={(v) => set("plannedEndAt", v)}
              placeholder="截止日期"
              ariaLabel="截止日期"
            />
            <PropPicker
              icon={<Rocket size={14} aria-hidden="true" />}
              label={release ? `v${release.version}` : "发版"}
              active={Boolean(release)}
              disabled={!values.projectId}
              title={values.projectId ? "放进本项目规划中的版本" : "先选择项目"}
              width={220}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!values.releaseId} onClick={() => (set("releaseId", ""), close())}>
                    暂不放入版本
                  </button>
                  {projectReleases.length === 0 ? <p className="nv-prop-empty">本项目没有规划中的版本</p> : null}
                  {projectReleases.map((r) => (
                    <button key={r.id} type="button" role="option" aria-selected={r.id === values.releaseId} onClick={() => (set("releaseId", r.id), close())}>
                      <Rocket size={14} aria-hidden="true" />v{r.version}
                      {r.title ? <small>{r.title}</small> : null}
                    </button>
                  ))}
                </>
              )}
            </PropPicker>
            <PropPicker icon={<Link2 size={14} aria-hidden="true" />} label={values.itrNo || "关联单号"} active={Boolean(values.itrNo)} width={220}>
              {(close) => (
                <div className="nv-prop-input">
                  <input
                    className="input"
                    autoFocus
                    value={values.itrNo}
                    maxLength={40}
                    placeholder="例如 REQ-2024-0312"
                    aria-label="关联单号"
                    onChange={(e) => set("itrNo", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        close();
                      }
                    }}
                  />
                </div>
              )}
            </PropPicker>
            <button
              type="button"
              className={`nv-prop sq${more ? " is-set" : ""}`}
              aria-label="更多属性：文档链接、各岗位负责人"
              title="更多属性"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="nv-create-foot">
          <label className="nv-switch">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
            <span aria-hidden="true" />
            继续新建
          </label>
          {fullHref ? (
            <Link href={fullHref} className="btn-ghost nv-head-btn" title="在全页里填写更多属性（标题和描述不会带过去）">
              展开为全页
            </Link>
          ) : null}
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "创建中…" : "创建需求"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 新建表单值 → API 请求体 */
export function requirementCreatePayload(v: RequirementCreateValues) {
  // 弹窗里的描述是富文本：summary 字段装的是 HTML，按 descriptionHtml 提交
  const { summary, ...rest } = requirementPayload(v) as Record<string, unknown>;
  void summary;
  return { ...rest, descriptionHtml: v.summary || "", releaseId: v.releaseId || null, itrNo: v.itrNo.trim() || null };
}
