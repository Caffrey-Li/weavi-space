"use client";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, CircleCheck, Clock, ExternalLink, Folder, Layers, Link2, List, Package, Paperclip, Rocket, RotateCcw, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { RichTextEditor, type RichTextHandle } from "@/components/editor/RichTextEditor";
import { PropPicker } from "@/components/ui/PropPicker";
import { DatePicker } from "@/components/ui/DatePicker";
import { Avatar } from "@/components/ui/Avatar";
import { BUG_GLYPH, SeverityDot } from "@/components/ui/Glyphs";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { ReqStatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { BUG_STATUS_OPTIONS, SEVERITY_LABELS, SEVERITY_OPTIONS, jobRoleLabel } from "@/lib/constants";
import { buildProductTree, type ProductTreeNode } from "@/lib/products";
import { BUG_ENVIRONMENTS } from "./BugCreateWorkspace";

type Member = { id: string; jobRole: string; user: { id: string; name: string; avatarUrl?: string | null } };
type ProductOpt = {
  id: string;
  name: string;
  code: string;
  nodes: { id: string; parentId: string | null; type: string; name: string; description: string | null; sortOrder: number }[];
};
type Person = { id: string; name: string; avatarUrl?: string | null };

export type BugFeedItem =
  | { kind: "log"; id: string; at: string; actor: { name: string; avatarUrl?: string | null } | null; message: string; isReturn: boolean }
  | { kind: "comment"; id: string; at: string; actor: { id: string; name: string; avatarUrl?: string | null }; html: string };

export type BugDetailData = {
  id: string;
  code: string;
  title: string;
  descriptionHtml: string;
  status: string;
  severity: string;
  frontend: Person | null;
  backend: Person | null;
  dueAt: string;
  environment: string;
  device: string;
  foundVersion: string;
  docUrl: string;
  reopenCount: number;
  /** 乐观锁版本号：保存时带上，服务端发现已被别人改过会返回 409 */
  revision: number;
  requirement: { id: string; title: string; code: string; status: string } | null;
  project: { id: string; name: string; iconUrl?: string | null; productId?: string | null } | null;
  productId: string;
  productNodeId: string;
  creator: { name: string; avatarUrl?: string | null };
  createdAt: string;
  updatedAt: string;
  lastEdit: { name: string; at: string } | null;
  feed: BugFeedItem[];
};

function relTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function stamp(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function PropRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rq-row">
      <span className="rq-row-name">
        {icon}
        {label}
      </span>
      <span className="rq-row-val">{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rq-group">
      <button type="button" className="rq-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {title}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? <div className="rq-group-body">{children}</div> : null}
    </section>
  );
}

/**
 * Bug 详情（11-05，版式同需求详情 Figma 24）：左侧主内容（编号 / 标题 / 属性胶囊 / 描述 / 操作条 / 备注与动态），右侧 340 属性面板。
 * 改动即时保存（描述失焦保存）；状态从「已解决 / 已关闭」改回待处理、进行中、重新打开时记一次退回，标题旁和属性面板显示被退回次数。
 * 备注：能看到这个 Bug 的人都可以写，作者或系统管理员可删除。
 */
export function BugDetailWorkspace({
  initial,
  canEdit,
  currentUserId,
  isAdmin,
}: {
  initial: BugDetailData;
  canEdit: boolean;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState<BugDetailData>(initial);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [reqs, setReqs] = useState<{ id: string; title: string }[] | null>(null);
  const [releases, setReleases] = useState<{ id: string; version: string; title: string | null }[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [savedAt, setSavedAt] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [tab, setTab] = useState<"all" | "comments" | "activity">("all");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState(initial.docUrl);
  const [deviceDraft, setDeviceDraft] = useState(initial.device);
  const [commentEmpty, setCommentEmpty] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const desc = useRef<RichTextHandle>(null);
  const comment = useRef<RichTextHandle>(null);
  const descDirty = useRef(false);
  const revision = useRef(initial.revision);

  // 保存后服务端数据刷新：同步过来（正在编辑的标题保留）
  useEffect(() => {
    setV((prev) => ({ ...initial, title: document.activeElement === titleRef.current ? prev.title : initial.title }));
    setDeviceDraft(initial.device);
  }, [initial]);

  const projectId = v.project?.id || "";
  useEffect(() => {
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProducts(d.products || []))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!projectId || !canEdit) return;
    let alive = true;
    fetch(`/api/projects/${projectId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => alive && setMembers(d.members || []))
      .catch(() => alive && setMembers([]));
    fetch(`/api/requirements?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setReqs(d.items || []))
      .catch(() => alive && setReqs([]));
    fetch(`/api/releases?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setReleases(d.items || []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, canEdit]);

  const product = products.find((p) => p.id === v.productId);
  const lockedProduct = v.project?.productId || "";
  const tree = useMemo(() => (product ? buildProductTree(product.nodes) : []), [product]);
  const paths = useMemo(() => {
    const m = new Map<string, string[]>();
    const walk = (l: ProductTreeNode[]) => l.forEach((n) => (m.set(n.id, n.path), walk(n.children)));
    walk(tree);
    return m;
  }, [tree]);

  /** 单字段即时保存 */
  const save = useCallback(
    async (patch: Record<string, unknown>, local?: Partial<BugDetailData>) => {
      if (local) setV((prev) => ({ ...prev, ...local }));
      const res = await fetch(`/api/bugs/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, revision: revision.current }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        // 409：别人刚改过这个 Bug。不刷新页面，保留正在编辑的内容
        if (res?.status === 409) {
          toast.error(`${(data as { error?: string }).error || "内容已被其他人修改"}（你这次的修改没有保存）`);
          return false;
        }
        toast.error((data as { error?: string }).error || "保存失败，请重试");
        router.refresh();
        return false;
      }
      if (typeof (data as { revision?: unknown }).revision === "number") revision.current = (data as { revision: number }).revision;
      setSavedAt(new Date().toISOString());
      router.refresh();
      return true;
    },
    [initial.id, router, toast],
  );

  async function changeStatus(to: string) {
    if (to === v.status || statusBusy) return;
    const from = v.status;
    setStatusBusy(true);
    setV((prev) => ({ ...prev, status: to }));
    const res = await fetch(`/api/bugs/${initial.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setStatusBusy(false);
    if (!res?.ok) {
      setV((prev) => ({ ...prev, status: from }));
      toast.error((data as { error?: string }).error || "状态未保存，请重试");
      return;
    }
    const label = BUG_STATUS_OPTIONS.find((s) => s.key === to)?.label || to;
    const back = ["resolved", "closed"].includes(from) && ["open", "in_progress", "reopened"].includes(to);
    toast.success(back ? `已退回为「${label}」，可在备注里写明原因` : `已改为「${label}」`);
    if (back) setTab("comments");
    setSavedAt(new Date().toISOString());
    router.refresh();
  }

  async function saveDescription() {
    if (!descDirty.current) return;
    descDirty.current = false;
    // 没保存成功（冲突或网络）时保留「有未保存的修改」，下次失焦再试
    if (!(await save({ descriptionHtml: desc.current?.getHtml() ?? "" }))) descDirty.current = true;
  }

  async function submitComment() {
    const html = comment.current?.getHtml() || "";
    if (!html || commenting) return;
    setCommenting(true);
    const res = await fetch(`/api/bugs/${initial.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: html }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setCommenting(false);
    if (!res?.ok) return toast.error((data as { error?: string }).error || "备注未保存，内容已保留");
    comment.current?.clear();
    router.refresh();
  }

  async function deleteComment(id: string) {
    if (!(await confirm({ title: "删除这条备注？", body: "删除后不能恢复。", confirmLabel: "删除", tone: "danger" }))) return;
    const res = await fetch(`/api/bugs/${initial.id}/comments/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("删除失败，请重试");
    router.refresh();
  }

  const StatusIcon = BUG_GLYPH[v.status] || BUG_GLYPH.open;
  const statusLabel = BUG_STATUS_OPTIONS.find((s) => s.key === v.status)?.label || v.status;
  const comments = v.feed.filter((f) => f.kind === "comment");
  const logs = v.feed.filter((f) => f.kind === "log");
  const feed = tab === "comments" ? comments : tab === "activity" ? logs : v.feed;
  const envLabel = BUG_ENVIRONMENTS.find((e) => e.key === v.environment)?.label;

  /* ---------------- 属性控件（胶囊与面板共用） ---------------- */

  const statusCtl = (pill: boolean) => (
    <PropPicker
      className={pill ? "nv-prop" : "rq-val"}
      disabled={!canEdit || statusBusy}
      icon={<StatusIcon size={14} aria-hidden="true" />}
      label={statusLabel}
      active
      ariaLabel="状态"
      width={180}
    >
      {(close) =>
        BUG_STATUS_OPTIONS.map((s) => {
          const Icon = BUG_GLYPH[s.key] || BUG_GLYPH.open;
          return (
            <button key={s.key} type="button" role="option" aria-selected={s.key === v.status} onClick={() => (void changeStatus(s.key), close())}>
              <Icon size={14} aria-hidden="true" />
              {s.label}
            </button>
          );
        })
      }
    </PropPicker>
  );

  const severityCtl = (pill: boolean) => (
    <PropPicker className={pill ? "nv-prop" : "rq-val"} disabled={!canEdit} icon={<SeverityDot severity={v.severity} />} label={SEVERITY_LABELS[v.severity] || v.severity} active ariaLabel="严重程度" width={160}>
      {(close) =>
        SEVERITY_OPTIONS.map((s) => (
          <button key={s} type="button" role="option" aria-selected={s === v.severity} onClick={() => (void save({ severity: s }, { severity: s }), close())}>
            <SeverityDot severity={s} />
            {SEVERITY_LABELS[s]}
          </button>
        ))
      }
    </PropPicker>
  );

  const ownerCtl = (pill: boolean, kind: "frontend" | "backend") => {
    const u = v[kind];
    const want = kind === "frontend" ? ["frontend"] : ["backend", "tech_lead"];
    const sorted = [...(members || [])].sort((a, b) => Number(want.includes(b.jobRole)) - Number(want.includes(a.jobRole)));
    const short = kind === "frontend" ? "前端" : "后端";
    return (
      <PropPicker
        className={pill ? "nv-prop" : "rq-val"}
        disabled={!canEdit || !projectId}
        icon={u ? <Avatar name={u.name} src={u.avatarUrl} size={16} /> : pill ? <UserRound size={14} aria-hidden="true" /> : null}
        label={u ? (pill ? `${short} · ${u.name}` : u.name) : pill ? `指派${short}` : "未指派"}
        active={Boolean(u)}
        ariaLabel={`${short}负责人`}
        width={220}
      >
        {(close) => (
          <>
            <button type="button" role="option" aria-selected={!u} onClick={() => (void save({ [`${kind}Id`]: null }, { [kind]: null }), close())}>
              暂不指派
            </button>
            {members === null ? <p className="nv-prop-empty">正在加载…</p> : members.length === 0 ? <p className="nv-prop-empty">该项目还没有成员</p> : null}
            {sorted.map((m) => (
              <button
                key={m.user.id}
                type="button"
                role="option"
                aria-selected={m.user.id === u?.id}
                onClick={() => (void save({ [`${kind}Id`]: m.user.id }, { [kind]: { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl } }), close())}
              >
                <Avatar name={m.user.name} src={m.user.avatarUrl} size={16} />
                {m.user.name}
                <small>{jobRoleLabel(m.jobRole)}</small>
              </button>
            ))}
          </>
        )}
      </PropPicker>
    );
  };

  const dueCtl = (placeholder: string) => (
    <DatePicker variant="pill" value={v.dueAt} disabled={!canEdit} onChange={(d) => void save({ dueAt: d || null }, { dueAt: d })} placeholder={placeholder} ariaLabel="截止日期" />
  );

  const envCtl = (pill: boolean) => (
    <PropPicker
      className={pill ? "nv-prop" : "rq-val"}
      disabled={!canEdit}
      icon={pill ? <ExternalLink size={14} aria-hidden="true" /> : null}
      label={envLabel ? `${envLabel}环境` : pill ? "环境" : "未指定"}
      active={Boolean(v.environment)}
      ariaLabel="环境"
      width={160}
    >
      {(close) => (
        <>
          <button type="button" role="option" aria-selected={!v.environment} onClick={() => (void save({ environment: null }, { environment: "" }), close())}>
            未指定
          </button>
          {BUG_ENVIRONMENTS.map((e) => (
            <button key={e.key} type="button" role="option" aria-selected={e.key === v.environment} onClick={() => (void save({ environment: e.key }, { environment: e.key }), close())}>
              {e.label}环境
            </button>
          ))}
        </>
      )}
    </PropPicker>
  );

  const reqCtl = (pill: boolean) => (
    <PropPicker
      className={pill ? "rq-act" : "rq-val"}
      disabled={!canEdit || !projectId}
      icon={pill ? <List size={14} aria-hidden="true" /> : null}
      label={v.requirement ? `${v.requirement.code ? `${v.requirement.code} ` : ""}${v.requirement.title}` : pill ? "关联需求" : "未关联"}
      active={Boolean(v.requirement)}
      ariaLabel="关联需求"
      width={300}
    >
      {(close) => (
        <>
          <button type="button" role="option" aria-selected={!v.requirement} onClick={() => (void save({ requirementId: null }, { requirement: null }), close())}>
            不关联需求
          </button>
          {reqs === null ? <p className="nv-prop-empty">正在加载…</p> : reqs.length === 0 ? <p className="nv-prop-empty">该项目还没有需求</p> : null}
          {(reqs || []).slice(0, 100).map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={r.id === v.requirement?.id}
              onClick={() => (void save({ requirementId: r.id }, { requirement: { id: r.id, title: r.title, code: "", status: "" } }), close())}
            >
              <span className="truncate">{r.title}</span>
            </button>
          ))}
        </>
      )}
    </PropPicker>
  );

  return (
    <div className="rq">
      <div className="rq-main">
        <div className="rq-inner">
          <div className="rq-code">
            {v.code}
            {v.reopenCount > 0 ? (
              <span className="nv-tag is-warning bug-return-tag" title="从「已解决 / 已关闭」被改回待处理、进行中或重新打开的次数">
                <RotateCcw size={12} aria-hidden="true" />
                被退回 {v.reopenCount} 次
              </span>
            ) : null}
          </div>
          <div className="nv-title-row">
            <textarea
              ref={titleRef}
              className="rq-title"
              rows={1}
              value={v.title}
              maxLength={200}
              readOnly={!canEdit}
              placeholder="Bug 标题"
              aria-label="Bug 标题（必填）"
              onChange={(e) => {
                setV((prev) => ({ ...prev, title: e.target.value.replace(/\n/g, "") }));
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              }}
              onBlur={() => {
                const t = v.title.trim();
                if (t && t !== initial.title) void save({ title: t });
                if (!t) setV((prev) => ({ ...prev, title: initial.title }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  desc.current?.focus();
                }
              }}
            />
            {canEdit ? (
              <GenTitleButton
                kind="bug"
                getHtml={() => desc.current?.getHtml() ?? v.descriptionHtml}
                onTitle={(t) => {
                  setV((prev) => ({ ...prev, title: t }));
                  if (t !== initial.title) void save({ title: t });
                }}
              />
            ) : null}
          </div>

          {/* 属性行（同新建 Bug，Figma 28）：状态 │ 严重程度 │ 前端 │ 后端 │ 截止日期 │ 环境 */}
          <div className="rq-props is-segmented" role="group" aria-label="Bug 属性">
            <span className="rq-seg">{statusCtl(true)}</span>
            <span className="rq-seg">{severityCtl(true)}</span>
            <span className="rq-seg">{ownerCtl(true, "frontend")}</span>
            <span className="rq-seg">{ownerCtl(true, "backend")}</span>
            <span className="rq-seg">{dueCtl("截止日期")}</span>
            <span className="rq-seg">{envCtl(true)}</span>
          </div>

          <div
            className="rq-desc"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void saveDescription();
            }}
          >
            {canEdit ? (
              <RichTextEditor
                ref={desc}
                ariaLabel="Bug 描述"
                variant="full"
                ownerType="bug"
                initialHtml={v.descriptionHtml}
                placeholder="复现步骤、预期结果、实际结果；可直接粘贴截图"
                onChange={() => {
                  descDirty.current = true;
                }}
                onSubmit={() => void saveDescription()}
                className="rq-desc-editor"
              />
            ) : v.descriptionHtml ? (
              <div className="doc-content rq-desc-read" dangerouslySetInnerHTML={{ __html: v.descriptionHtml }} />
            ) : (
              <p className="rq-muted">还没有描述。</p>
            )}
          </div>
          <p suppressHydrationWarning className="rq-editinfo">
            <Clock size={14} aria-hidden="true" />
            {v.lastEdit ? `最后编辑 ${v.lastEdit.name} · ${relTime(v.lastEdit.at)}` : "描述失焦后自动保存"}
          </p>

          <div className="rq-actbar">
            {reqCtl(true)}
            {canEdit ? (
              <div className="nv-prop-wrap">
                <button type="button" className="rq-act" aria-expanded={linkOpen} onClick={() => (setLinkDraft(v.docUrl), setLinkOpen((o) => !o))}>
                  <Link2 size={14} aria-hidden="true" />
                  {v.docUrl ? "相关链接" : "添加链接"}
                </button>
                {linkOpen ? (
                  <form
                    className="rq-link-pop"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const url = linkDraft.trim();
                      if (url && !/^https?:\/\//i.test(url)) return toast.error("链接需以 http(s):// 开头");
                      if (await save({ docUrl: url || null }, { docUrl: url })) setLinkOpen(false);
                    }}
                  >
                    <input className="input" autoFocus type="url" value={linkDraft} placeholder="https://（日志、监控、文档等）" aria-label="相关链接" onChange={(e) => setLinkDraft(e.target.value)} />
                    <button type="submit" className="btn-primary nv-head-btn">
                      保存
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
            {canEdit ? (
              <button type="button" className="rq-act" onClick={() => desc.current?.pickFile("file")}>
                <Paperclip size={14} aria-hidden="true" />
                上传附件
              </button>
            ) : null}
            {v.docUrl ? (
              <a href={v.docUrl} target="_blank" rel="noreferrer noopener" className="rq-doclink" title={v.docUrl}>
                打开链接 ↗
              </a>
            ) : null}
          </div>

          {v.requirement ? (
            <section className="rq-sub" aria-labelledby="bug-req-title">
              <div className="rq-sub-head">
                <h2 id="bug-req-title">关联需求</h2>
              </div>
              <ul className="detail-list">
                <li>
                  {v.requirement.code ? <span className="shrink-0 font-mono text-xs text-neutral-500">{v.requirement.code}</span> : null}
                  <Link href={`/requirements/${v.requirement.id}`} className="min-w-0 flex-1 truncate text-link" title={v.requirement.title}>
                    {v.requirement.title}
                  </Link>
                  {v.requirement.status ? <ReqStatusBadge status={v.requirement.status} size="small" /> : null}
                </li>
              </ul>
            </section>
          ) : null}

          <section className="rq-feed" aria-label="备注与动态">
            <div className="rq-tabs" role="tablist" aria-label="备注与动态">
              {(
                [
                  ["all", "全部"],
                  ["comments", `备注${comments.length ? ` ${comments.length}` : ""}`],
                  ["activity", "动态"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rq-tab${tab === k ? " is-active" : ""}`} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            {tab !== "activity" ? (
              <RichTextEditor
                ref={comment}
                ariaLabel="备注"
                variant="compact"
                toolbar="bottom"
                ownerType="comment"
                placeholder="添加备注：定位原因、修复说明、退回原因等，可粘贴图片"
                onChange={(html) => setCommentEmpty(!html)}
                onSubmit={() => void submitComment()}
                toolbarEnd={
                  <button type="button" className="btn-primary nv-head-btn" disabled={commentEmpty || commenting} onClick={() => void submitComment()}>
                    {commenting ? "保存中…" : "添加备注"}
                  </button>
                }
              />
            ) : null}
            <ol className="rq-feed-list">
              {feed.length === 0 ? <li className="rq-muted rq-feed-empty">{tab === "comments" ? "还没有备注。" : "暂无动态。"}</li> : null}
              {feed.map((f) =>
                f.kind === "log" ? (
                  <li key={`l-${f.id}`} className={`rq-log${f.isReturn ? " is-return" : ""}`}>
                    <Avatar name={f.actor?.name || "系统"} src={f.actor?.avatarUrl} size={16} />
                    <span>
                      <b>{f.actor?.name || "系统"}</b> {f.message}
                    </span>
                    <time suppressHydrationWarning dateTime={f.at} title={stamp(f.at)}>
                      · {relTime(f.at)}
                    </time>
                  </li>
                ) : (
                  <li key={`c-${f.id}`} className="rq-comment">
                    <div className="rq-comment-head">
                      <Avatar name={f.actor.name} src={f.actor.avatarUrl} size={20} />
                      <b>{f.actor.name}</b>
                      <time suppressHydrationWarning dateTime={f.at} title={stamp(f.at)}>
                        {relTime(f.at)}
                      </time>
                      {f.actor.id === currentUserId || isAdmin ? (
                        <button type="button" className="icon-button rq-comment-del" aria-label="删除备注" title="删除备注" onClick={() => void deleteComment(f.id)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    <div className="doc-content rq-comment-body" dangerouslySetInnerHTML={{ __html: f.html }} />
                  </li>
                ),
              )}
            </ol>
          </section>
        </div>
      </div>

      <aside className="rq-panel" aria-label="Bug 属性">
        <div className="rq-panel-head">
          <h2>属性</h2>
          <span suppressHydrationWarning>{savedAt ? `${relTime(savedAt)}更新` : `${relTime(v.updatedAt)}更新`}</span>
        </div>
        <Group title="详情">
          <PropRow icon={<CircleCheck size={14} aria-hidden="true" />} label="状态">
            {statusCtl(false)}
          </PropRow>
          <PropRow icon={<RotateCcw size={14} aria-hidden="true" />} label="被退回">
            <span className={`rq-val is-static${v.reopenCount ? " bug-return-val" : " rq-muted"}`} title="从「已解决 / 已关闭」被改回待处理、进行中或重新打开的次数">
              {v.reopenCount ? `${v.reopenCount} 次` : "0 次"}
            </span>
          </PropRow>
          <PropRow icon={<TriangleAlert size={14} aria-hidden="true" />} label="严重程度">
            {severityCtl(false)}
          </PropRow>
          <PropRow icon={<UserRound size={14} aria-hidden="true" />} label="前端负责人">
            {ownerCtl(false, "frontend")}
          </PropRow>
          <PropRow icon={<UserRound size={14} aria-hidden="true" />} label="后端负责人">
            {ownerCtl(false, "backend")}
          </PropRow>
          <PropRow icon={<Calendar size={14} aria-hidden="true" />} label="截止日期">
            {dueCtl("选择日期")}
          </PropRow>
          <PropRow icon={<List size={14} aria-hidden="true" />} label="关联需求">
            {reqCtl(false)}
          </PropRow>
        </Group>
        <Group title="产品结构">
          <PropRow icon={<Package size={14} aria-hidden="true" />} label="所属产品">
            <PropPicker
              className="rq-val"
              disabled={!canEdit || Boolean(lockedProduct)}
              label={(lockedProduct ? products.find((p) => p.id === lockedProduct)?.name : product?.name) || (canEdit ? "选择产品" : "未关联")}
              active={Boolean(product || lockedProduct)}
              ariaLabel={lockedProduct ? "所属产品（跟随项目）" : "所属产品"}
              width={240}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!v.productId} onClick={() => (void save({ productId: null, productNodeId: null }, { productId: "", productNodeId: "" }), close())}>
                    不关联产品
                  </button>
                  {products.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected={p.id === v.productId} onClick={() => (void save({ productId: p.id, productNodeId: null }, { productId: p.id, productNodeId: "" }), close())}>
                      {p.name}
                      <small>{p.code}</small>
                    </button>
                  ))}
                </>
              )}
            </PropPicker>
          </PropRow>
          <PropRow icon={<Layers size={14} aria-hidden="true" />} label="功能模块">
            <PropPicker
              className="rq-val"
              disabled={!canEdit || !product}
              label={v.productNodeId ? paths.get(v.productNodeId)?.join(" › ") || "已选模块" : canEdit ? "选择菜单 / 模块" : "未指定"}
              active={Boolean(v.productNodeId)}
              ariaLabel="功能模块"
              width={280}
            >
              {(close) => {
                const out: React.ReactNode[] = [
                  <button key="none" type="button" role="option" aria-selected={!v.productNodeId} onClick={() => (void save({ productNodeId: null }, { productNodeId: "" }), close())}>
                    不指定模块
                  </button>,
                ];
                const walk = (l: ProductTreeNode[], depth: number) =>
                  l.forEach((n) => {
                    const ok = n.type !== "menu";
                    out.push(
                      <button
                        key={n.id}
                        type="button"
                        role="option"
                        disabled={!ok}
                        className={ok ? undefined : "is-group"}
                        aria-selected={n.id === v.productNodeId}
                        style={{ paddingLeft: 8 + depth * 14 }}
                        onClick={() => ok && (void save({ productNodeId: n.id }, { productNodeId: n.id }), close())}
                      >
                        {n.name}
                      </button>,
                    );
                    walk(n.children, depth + 1);
                  });
                walk(tree, 0);
                return out;
              }}
            </PropPicker>
          </PropRow>
        </Group>
        <Group title="项目与发版">
          <PropRow icon={<Folder size={14} aria-hidden="true" />} label="项目">
            {v.project ? (
              <Link href={`/projects/${v.project.id}`} className="rq-val is-static" title="所属项目">
                <ProjectIcon name={v.project.name} src={v.project.iconUrl} size={16} />
                {v.project.name}
              </Link>
            ) : (
              <span className="rq-val is-static rq-muted">未归属</span>
            )}
          </PropRow>
          <PropRow icon={<Rocket size={14} aria-hidden="true" />} label="发现版本">
            <PropPicker
              className="rq-val"
              disabled={!canEdit || !projectId}
              label={v.foundVersion ? `v${v.foundVersion.replace(/^v/i, "")}` : canEdit ? "选择版本" : "未指定"}
              active={Boolean(v.foundVersion)}
              ariaLabel="发现版本"
              width={220}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!v.foundVersion} onClick={() => (void save({ foundVersion: null }, { foundVersion: "" }), close())}>
                    未指定
                  </button>
                  {releases.length === 0 ? <p className="nv-prop-empty">该项目还没有发版</p> : null}
                  {releases.map((r) => (
                    <button key={r.id} type="button" role="option" aria-selected={r.version === v.foundVersion} onClick={() => (void save({ foundVersion: r.version }, { foundVersion: r.version }), close())}>
                      <span className="font-mono">v{r.version.replace(/^v/i, "")}</span>
                      {r.title ? <small>{r.title}</small> : null}
                    </button>
                  ))}
                </>
              )}
            </PropPicker>
          </PropRow>
        </Group>
        <Group title="环境">
          <PropRow icon={<ExternalLink size={14} aria-hidden="true" />} label="环境">
            {envCtl(false)}
          </PropRow>
          <PropRow icon={<ExternalLink size={14} aria-hidden="true" />} label="浏览器 / 设备">
            {canEdit ? (
              <input
                className="rq-inline-input"
                value={deviceDraft}
                maxLength={80}
                placeholder="如 Chrome 130 · macOS"
                aria-label="浏览器 / 设备"
                onChange={(e) => setDeviceDraft(e.target.value)}
                onBlur={() => {
                  const d = deviceDraft.trim();
                  if (d !== v.device) void save({ device: d || null }, { device: d });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                }}
              />
            ) : (
              <span className={`rq-val is-static${v.device ? "" : " rq-muted"}`}>{v.device || "未填写"}</span>
            )}
          </PropRow>
        </Group>
        <div className="rq-meta">
          <p>
            <UserRound size={14} aria-hidden="true" />
            提交人 {v.creator.name}
          </p>
          <p suppressHydrationWarning>
            <Clock size={14} aria-hidden="true" />
            提交于 {stamp(v.createdAt)}
          </p>
          <p suppressHydrationWarning>
            <Clock size={14} aria-hidden="true" />
            更新于 {stamp(v.updatedAt)}
          </p>
        </div>
      </aside>
    </div>
  );
}
