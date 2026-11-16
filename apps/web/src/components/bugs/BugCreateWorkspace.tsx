"use client";
import { TemplateMenu } from "@/components/requirements/TemplateMenu";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { generateTitle } from "@/lib/title-gen-shared";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Check, ChevronDown, Clock, ExternalLink, Folder, Layers, Link2, List, Package, Paperclip, Rocket, TriangleAlert, UserRound } from "lucide-react";
import { RichTextEditor, type RichTextHandle } from "@/components/editor/RichTextEditor";
import { PropPicker } from "@/components/ui/PropPicker";
import { DatePicker } from "@/components/ui/DatePicker";
import { Avatar } from "@/components/ui/Avatar";
import { BUG_GLYPH, SeverityDot } from "@/components/ui/Glyphs";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { useToast } from "@/components/ui/Toast";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { SEVERITY_LABELS, SEVERITY_OPTIONS, jobRoleLabel } from "@/lib/constants";
import { buildProductTree, type ProductTreeNode } from "@/lib/products";

type MetaProject = { id: string; name: string; key: string; iconUrl?: string | null; productId?: string | null };
type Member = { id: string; jobRole: string; user: { id: string; name: string; avatarUrl?: string | null; globalRole: string } };
type ProductOpt = {
  id: string;
  name: string;
  code: string;
  nodes: { id: string; parentId: string | null; type: string; name: string; description: string | null; sortOrder: number }[];
};

export const BUG_ENVIRONMENTS = [
  { key: "production", label: "生产" },
  { key: "staging", label: "预发" },
  { key: "test", label: "测试" },
  { key: "dev", label: "开发" },
] as const;

/** 描述预置模板（灰色占位，可直接改） */
const TEMPLATE =
  "<h3>复现步骤</h3><ol><li>进入哪个页面</li><li>做了什么操作</li><li>在什么条件下出现</li></ol><h3>预期结果</h3><p>应该发生什么</p><h3>实际结果</h3><p>实际发生了什么，附报错信息或录屏</p>";

export type BugCreateInitial = {
  projectId: string;
  requirement: { id: string; title: string; code: string } | null;
  productId: string;
  productNodeId: string;
};

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
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

/** 属性面板分组（可折叠，Figma 28：详情 / 产品结构 / 项目与发版 / 环境） */
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

const DRAFT_KEY = "pm-bug-draft";

function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
}


/**
 * 新建 Bug 全页（Figma 28）：结构同新建需求。
 * 描述预置「复现步骤 / 预期结果 / 实际结果」模板；属性胶囊为状态、严重程度、处理人、截止日期、环境；
 * 属性面板分组：详情（含关联需求）、产品结构、项目与发版、环境（环境、浏览器 / 设备）；标题和描述自动存草稿（只存本机）。
 */
export function BugCreateWorkspace({
  initial,
  initialProject,
  crumbs,
  lockProject,
  returnHref,
}: {
  initial: BugCreateInitial;
  /** 服务端已查到的项目：首屏就能显示项目名，不用等 /api/meta */
  initialProject?: MetaProject | null;
  crumbs: WorkCrumb[];
  lockProject: boolean;
  returnHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [projectId, setProjectId] = useState(initial.projectId);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("major");
  // 前端负责人 / 后端负责人（Figma 28）
  const [owners, setOwners] = useState<{ frontend: string; backend: string }>({ frontend: "", backend: "" });
  const [dueAt, setDueAt] = useState("");
  const [environment, setEnvironment] = useState("");
  const [device, setDevice] = useState("");
  const [foundVersion, setFoundVersion] = useState("");
  const [requirement, setRequirement] = useState(initial.requirement);
  const [productId, setProductId] = useState(initial.productId);
  const [productNodeId, setProductNodeId] = useState(initial.productNodeId);
  const [projects, setProjects] = useState<MetaProject[]>(initialProject ? [initialProject] : []);
  const [members, setMembers] = useState<Member[]>([]);
  const [reqs, setReqs] = useState<{ id: string; title: string }[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [pristine, setPristine] = useState(true);
  const [releases, setReleases] = useState<{ id: string; version: string; title: string | null }[]>([]);
  const [docUrl, setDocUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [descHtml, setDescHtml] = useState(TEMPLATE);
  const [savedAt, setSavedAt] = useState("");
  const [initialHtml, setInitialHtml] = useState(TEMPLATE);
  const desc = useRef<RichTextHandle>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProjects((prev) => (d.projects?.length ? d.projects : prev)))
      .catch(() => undefined);
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProducts(d.products || []))
      .catch(() => undefined);
  }, []);
  // 草稿：恢复（锁定项目时只恢复同项目的）/ 停止输入 0.8 秒后保存
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { title?: string; descriptionHtml?: string; projectId?: string; at?: string };
      if ((d.title || (d.descriptionHtml && d.descriptionHtml !== TEMPLATE)) && (!lockProject || d.projectId === initial.projectId)) {
        setTitle(d.title || "");
        if (d.descriptionHtml) {
          setInitialHtml(d.descriptionHtml);
          setDescHtml(d.descriptionHtml);
          setPristine(d.descriptionHtml === TEMPLATE);
          setEditorKey((k) => k + 1);
        }
        setSavedAt(d.at || "");
      }
    } catch {
      /* 无存储时不恢复 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (!title && descHtml === TEMPLATE) window.localStorage.removeItem(DRAFT_KEY);
        else {
          const at = new Date().toISOString();
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, descriptionHtml: descHtml, projectId, at }));
          setSavedAt(at);
        }
      } catch {
        /* 忽略 */
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [title, descHtml, projectId]);

  useEffect(() => {
    if (!projectId) {
      setMembers([]);
      setReqs([]);
      setReleases([]);
      return;
    }
    fetch(`/api/releases?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setReleases(d.items || []))
      .catch(() => setReleases([]));
    let alive = true;
    fetch(`/api/projects/${projectId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => alive && setMembers(d.members || []))
      .catch(() => undefined);
    fetch(`/api/requirements?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setReqs(d.items || []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId);
  const ownerUser = (kind: "frontend" | "backend") => members.find((m) => m.user.id === owners[kind])?.user;
  const product = products.find((p) => p.id === productId);
  // 级联：项目挂了产品时，所属产品锁定为项目的产品
  const lockedProduct = projects.find((p) => p.id === projectId)?.productId || "";
  useEffect(() => {
    if (lockedProduct && lockedProduct !== productId) {
      setProductId(lockedProduct);
      setProductNodeId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedProduct]);
  const tree = useMemo(() => (product ? buildProductTree(product.nodes) : []), [product]);
  const paths = useMemo(() => {
    const m = new Map<string, string[]>();
    const walk = (l: ProductTreeNode[]) => l.forEach((n) => (m.set(n.id, n.path), walk(n.children)));
    walk(tree);
    return m;
  }, [tree]);
  const OpenIcon = BUG_GLYPH.open;
  const envLabel = BUG_ENVIRONMENTS.find((e) => e.key === environment)?.label;

  async function create() {
    if (busy) return;
    let t = title.trim();
    const html = desc.current?.getHtml() || "";
    if (!projectId) {
      setError(t ? "请选择所属项目" : "请填写 Bug 标题");
      if (!t) titleRef.current?.focus();
      return;
    }
    setBusy(true);
    // 没填标题时按描述自动生成（没改过的模板不算描述）
    if (!t && html && html !== TEMPLATE) {
      t = (await generateTitle(html, "bug")).title;
      if (t) setTitle(t);
    }
    if (!t) {
      setBusy(false);
      setError("请填写 Bug 标题");
      titleRef.current?.focus();
      return;
    }
    setError("");
    const res = await fetch("/api/bugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: t,
        // 没改过的模板不保存
        descriptionHtml: html === TEMPLATE ? "" : html,
        projectId,
        requirementId: requirement?.id || null,
        severity,
        frontendId: owners.frontend || null,
        backendId: owners.backend || null,
        dueAt: dueAt || null,
        environment: environment || null,
        device,
        foundVersion,
        docUrl: docUrl || null,
        productId: productId || null,
        productNodeId: productNodeId || null,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError((data as { error?: string }).error || "网络异常，结果未确认。请稍后在 Bug 列表核对后再决定是否重试。");
      return;
    }
    const id = (data as { id?: string }).id;
    // 提交后进 Bug 详情页（11-05）；拿不到 id 时回到项目 Bug 列表
    const listHref = id ? `/bugs/${id}` : `/projects/${projectId}/bugs`;
    toast.show({ tone: "success", message: `已提交 Bug「${t.length > 24 ? `${t.slice(0, 24)}…` : t}」`, action: { label: "查看", onClick: () => router.push(listHref) } });
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 忽略 */
    }
    setSavedAt("");
    if (keep) {
      setTitle("");
      setInitialHtml(TEMPLATE);
      setDescHtml(TEMPLATE);
      setDocUrl("");
      setEditorKey((k) => k + 1);
      setPristine(true);
      titleRef.current?.focus();
    } else {
      router.push(listHref);
    }
    router.refresh();
  }

  const envPicker = (cls: string) => (
    <PropPicker className={cls} icon={cls === "nv-prop" ? <ExternalLink size={14} aria-hidden="true" /> : null} label={envLabel ? `${envLabel}环境` : cls === "nv-prop" ? "环境" : "选择环境"} active={Boolean(environment)} ariaLabel="环境" width={160}>
      {(close) => (
        <>
          <button type="button" role="option" aria-selected={!environment} onClick={() => (setEnvironment(""), close())}>
            未指定
          </button>
          {BUG_ENVIRONMENTS.map((e) => (
            <button key={e.key} type="button" role="option" aria-selected={e.key === environment} onClick={() => (setEnvironment(e.key), close())}>
              {e.label}环境
            </button>
          ))}
        </>
      )}
    </PropPicker>
  );
  const severityPicker = (cls: string) => (
    <PropPicker className={cls} icon={<SeverityDot severity={severity} />} label={SEVERITY_LABELS[severity]} active ariaLabel="严重程度" width={160}>
      {(close) =>
        SEVERITY_OPTIONS.map((s) => (
          <button key={s} type="button" role="option" aria-selected={s === severity} onClick={() => (setSeverity(s), close())}>
            <SeverityDot severity={s} />
            {SEVERITY_LABELS[s]}
          </button>
        ))
      }
    </PropPicker>
  );
  const assigneePicker = (cls: string, kind: "frontend" | "backend") => {
    const u = ownerUser(kind);
    const label = kind === "frontend" ? "前端负责人" : "后端负责人";
    // 推荐岗位排在前面
    const want = kind === "frontend" ? ["frontend"] : ["backend", "tech_lead"];
    const sorted = [...members].sort((a, b) => Number(want.includes(b.jobRole)) - Number(want.includes(a.jobRole)));
    return (
      <PropPicker
        className={cls}
        icon={u ? <Avatar name={u.name} src={u.avatarUrl} size={16} /> : cls === "nv-prop" ? <UserRound size={14} aria-hidden="true" /> : null}
        label={u?.name ? (cls === "nv-prop" ? `${kind === "frontend" ? "前端" : "后端"} · ${u.name}` : u.name) : kind === "frontend" ? "指派前端" : "指派后端"}
        active={Boolean(u)}
        disabled={!projectId}
        title={projectId ? undefined : "先选择项目"}
        ariaLabel={label}
        width={220}
      >
        {(close) => (
          <>
            <button type="button" role="option" aria-selected={!owners[kind]} onClick={() => (setOwners((o) => ({ ...o, [kind]: "" })), close())}>
              暂不指派
            </button>
            {members.length === 0 ? <p className="nv-prop-empty">该项目还没有成员</p> : null}
            {sorted.map((m) => (
              <button key={m.user.id} type="button" role="option" aria-selected={m.user.id === owners[kind]} onClick={() => (setOwners((o) => ({ ...o, [kind]: m.user.id })), close())}>
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

  const reqPicker = (cls: string) => (
    <PropPicker
      className={cls}
      icon={cls === "rq-act" ? <List size={14} aria-hidden="true" /> : null}
      label={requirement ? `${requirement.code ? `${requirement.code} ` : ""}${requirement.title}` : cls === "rq-act" ? "关联需求" : "选择需求"}
      active={Boolean(requirement)}
      disabled={!projectId}
      title={projectId ? undefined : "先选择项目"}
      ariaLabel="关联需求"
      width={300}
    >
      {(close) => (
        <>
          <button type="button" role="option" aria-selected={!requirement} onClick={() => (setRequirement(null), close())}>
            不关联需求
          </button>
          {reqs.length === 0 ? <p className="nv-prop-empty">该项目还没有需求</p> : null}
          {reqs.slice(0, 100).map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={r.id === requirement?.id} onClick={() => (setRequirement({ id: r.id, title: r.title, code: "" }), close())}>
              <span className="truncate">{r.title}</span>
            </button>
          ))}
        </>
      )}
    </PropPicker>
  );

  const headActions = (
    <span className="rq-head-actions">
        <span className="rq-draft">{savedAt ? `草稿已自动保存 · ${relTime(savedAt)}` : ""}</span>
        <Link href={returnHref} className="btn-secondary nv-head-btn">
          取消
        </Link>
        <button type="button" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined} onClick={() => void create()}>
          {busy ? "提交中…" : "提交 Bug"}
        </button>
    </span>
  );

  return (
    <>
    <WorkHeader crumbs={crumbs} actions={headActions} />
    <div className="rq">
      <div className="rq-main">
        <div className="rq-inner">
          <div className="rq-code">
            新 Bug · {project?.name || "选择项目"}
            <TemplateMenu
              kind="bug"
              projectId={projectId}
              current={() => ({ severity, owners, environment, device, productId, productNodeId, descriptionHtml: desc.current?.getHtml() ?? descHtml })}
              onApply={(d) => {
                if (typeof d.severity === "string" && d.severity) setSeverity(d.severity);
                if (d.owners && typeof d.owners === "object") setOwners({ frontend: "", backend: "", ...(d.owners as Record<string, string>) });
                if (typeof d.environment === "string") setEnvironment(d.environment);
                if (typeof d.device === "string") setDevice(d.device);
                if (typeof d.productId === "string") {
                  setProductId(d.productId);
                  setProductNodeId(String(d.productNodeId || ""));
                }
                if (typeof d.descriptionHtml === "string" && d.descriptionHtml) {
                  setDescHtml(d.descriptionHtml);
                  setInitialHtml(d.descriptionHtml);
                  setEditorKey((k) => k + 1);
                }
              }}
            />
          </div>
          <div className="nv-title-row">
          <textarea
            ref={titleRef}
            className="rq-title"
            rows={1}
            value={title}
            maxLength={200}
            placeholder="Bug 标题，一句话说明现象"
            aria-label="Bug 标题（必填）"
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value.replace(/\n/g, ""));
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) void create();
                else desc.current?.focus();
              }
            }}
          />
          <GenTitleButton
            kind="bug"
            getHtml={() => {
              const h = desc.current?.getHtml() || descHtml;
              return h === TEMPLATE ? "" : h;
            }}
            onTitle={(t) => {
              setTitle(t);
              if (error) setError("");
            }}
          />
          </div>
          {error ? (
            <p className="nv-create-error" role="alert">
              {error}
            </p>
          ) : null}
          {/* 属性行（Figma 28）：状态 │ 严重程度 │ 处理人 │ 截止日期 │ 环境，细竖线分段 */}
          <div className="rq-props is-segmented" role="group" aria-label="Bug 属性">
            <span className="rq-seg">
              <span className="nv-prop is-static" title="新 Bug 从「待处理」开始">
                <OpenIcon size={14} aria-hidden="true" />
                待处理
              </span>
            </span>
            <span className="rq-seg">{severityPicker("nv-prop")}</span>
            <span className="rq-seg">{assigneePicker("nv-prop", "frontend")}</span>
            <span className="rq-seg">{assigneePicker("nv-prop", "backend")}</span>
            <span className="rq-seg">
              <DatePicker variant="pill" value={dueAt} onChange={setDueAt} placeholder="截止日期" ariaLabel="截止日期" />
            </span>
            <span className="rq-seg">{envPicker("nv-prop")}</span>
          </div>
          <div className="rq-desc">
            <RichTextEditor
              key={editorKey}
              ref={desc}
              ariaLabel="Bug 描述"
              variant="full"
              ownerType="bug"
              initialHtml={initialHtml}
              placeholder="复现步骤、预期结果、实际结果；可直接粘贴截图"
              onSubmit={() => void create()}
              onChange={(html) => {
                setPristine(html === TEMPLATE);
                setDescHtml(html);
              }}
              className={`rq-desc-editor${pristine ? " is-template" : ""}`}
            />
          </div>
          <p className="rq-editinfo">
            <Clock size={14} aria-hidden="true" />
            Markdown 快捷键可用，输入 / 插入块
          </p>
          <div className="rq-actbar">
            {reqPicker("rq-act")}
            <div className="nv-prop-wrap">
              <button
                type="button"
                className="rq-act"
                aria-expanded={linkOpen}
                onClick={() => {
                  setLinkDraft(docUrl);
                  setLinkOpen((o) => !o);
                }}
              >
                <Link2 size={14} aria-hidden="true" />
                {docUrl ? "已添加链接" : "添加链接"}
              </button>
              {linkOpen ? (
                <form
                  className="rq-link-pop"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const url = linkDraft.trim();
                    if (url && !/^https?:\/\//i.test(url)) return toast.error("链接需以 http(s):// 开头");
                    setDocUrl(url);
                    setLinkOpen(false);
                  }}
                >
                  <input className="input" autoFocus type="url" value={linkDraft} placeholder="https://（日志、监控、文档等）" aria-label="相关链接" onChange={(e) => setLinkDraft(e.target.value)} />
                  <button type="submit" className="btn-primary nv-head-btn">
                    保存
                  </button>
                </form>
              ) : null}
            </div>
            <button type="button" className="rq-act" onClick={() => desc.current?.pickFile("file")}>
              <Paperclip size={14} aria-hidden="true" />
              上传附件
            </button>
            <button type="button" className="rq-act" title="录屏文件不超过 5MB" onClick={() => desc.current?.pickFile("file")}>
              <Paperclip size={14} aria-hidden="true" />
              上传录屏
            </button>
          </div>
        </div>
      </div>

      <aside className="rq-panel" aria-label="Bug 属性">
        <div className="rq-panel-head">
          <h2>属性</h2>
          <span>未保存</span>
        </div>
        <Group title="详情">
            <Row icon={<Check size={14} aria-hidden="true" />} label="状态">
              <span className="rq-val is-static">
                <OpenIcon size={14} aria-hidden="true" />
                待处理
              </span>
            </Row>
            <Row icon={<TriangleAlert size={14} aria-hidden="true" />} label="严重程度">
              {severityPicker("rq-val")}
            </Row>
            <Row icon={<UserRound size={14} aria-hidden="true" />} label="前端负责人">
              {assigneePicker("rq-val", "frontend")}
            </Row>
            <Row icon={<UserRound size={14} aria-hidden="true" />} label="后端负责人">
              {assigneePicker("rq-val", "backend")}
            </Row>
            <Row icon={<Calendar size={14} aria-hidden="true" />} label="截止日期">
              <DatePicker variant="pill" value={dueAt} onChange={setDueAt} placeholder="选择日期" ariaLabel="截止日期" />
            </Row>
            <Row icon={<List size={14} aria-hidden="true" />} label="关联需求">
              {reqPicker("rq-val")}
            </Row>
        </Group>
        <Group title="产品结构">
            <Row icon={<Package size={14} aria-hidden="true" />} label="所属产品">
              <PropPicker
                className="rq-val"
                disabled={Boolean(lockedProduct)}
                label={product?.name || "选择产品"}
                active={Boolean(product)}
                ariaLabel={lockedProduct ? "所属产品（跟随项目）" : "所属产品"}
                width={240}
              >
                {(close) => (
                  <>
                    <button type="button" role="option" aria-selected={!productId} onClick={() => (setProductId(""), setProductNodeId(""), close())}>
                      不关联产品
                    </button>
                    {products.map((p) => (
                      <button key={p.id} type="button" role="option" aria-selected={p.id === productId} onClick={() => (setProductId(p.id), setProductNodeId(""), close())}>
                        {p.name}
                        <small>{p.code}</small>
                      </button>
                    ))}
                  </>
                )}
              </PropPicker>
            </Row>
            <Row icon={<Layers size={14} aria-hidden="true" />} label="功能模块">
              <PropPicker
                className="rq-val"
                disabled={!product}
                label={productNodeId ? paths.get(productNodeId)?.join(" › ") || "已选模块" : "选择菜单 / 模块"}
                active={Boolean(productNodeId)}
                ariaLabel="功能模块"
                width={280}
              >
                {(close) => {
                  const out: React.ReactNode[] = [
                    <button key="none" type="button" role="option" aria-selected={!productNodeId} onClick={() => (setProductNodeId(""), close())}>
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
                          aria-selected={n.id === productNodeId}
                          style={{ paddingLeft: 8 + depth * 14 }}
                          onClick={() => ok && (setProductNodeId(n.id), close())}
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
            </Row>
        </Group>
        <Group title="项目与发版">
            <Row icon={<Folder size={14} aria-hidden="true" />} label="项目">
              <PropPicker
                className="rq-val"
                disabled={lockProject}
                icon={project ? <ProjectIcon name={project.name} src={project.iconUrl} size={16} /> : null}
                label={project?.name || "选择项目"}
                active={Boolean(project)}
                ariaLabel="所属项目"
                width={240}
              >
                {(close) =>
                  projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === projectId}
                      onClick={() => (setProjectId(p.id), setOwners({ frontend: "", backend: "" }), setRequirement(null), close())}
                    >
                      <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                      {p.name}
                    </button>
                  ))
                }
              </PropPicker>
            </Row>
            <Row icon={<Rocket size={14} aria-hidden="true" />} label="发现版本">
              <PropPicker
                className="rq-val"
                label={foundVersion ? `v${foundVersion.replace(/^v/i, "")}` : "选择版本"}
                active={Boolean(foundVersion)}
                disabled={!projectId}
                title={projectId ? undefined : "先选择项目"}
                ariaLabel="发现版本"
                width={220}
              >
                {(close) => (
                  <>
                    <button type="button" role="option" aria-selected={!foundVersion} onClick={() => (setFoundVersion(""), close())}>
                      未指定
                    </button>
                    {releases.length === 0 ? <p className="nv-prop-empty">该项目还没有发版</p> : null}
                    {releases.map((r) => (
                      <button key={r.id} type="button" role="option" aria-selected={r.version === foundVersion} onClick={() => (setFoundVersion(r.version), close())}>
                        <span className="font-mono">v{r.version.replace(/^v/i, "")}</span>
                        {r.title ? <small>{r.title}</small> : null}
                      </button>
                    ))}
                  </>
                )}
              </PropPicker>
            </Row>
        </Group>
        <Group title="环境">
            <Row icon={<ExternalLink size={14} aria-hidden="true" />} label="环境">
              {envPicker("rq-val")}
            </Row>
            <Row icon={<ExternalLink size={14} aria-hidden="true" />} label="浏览器 / 设备">
              <input className="rq-inline-input" value={device} maxLength={80} placeholder="如 Chrome 130 · macOS" aria-label="浏览器 / 设备" onChange={(e) => setDevice(e.target.value)} />
            </Row>
        </Group>
        <label className="nv-switch rq-keep">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span aria-hidden="true" />
          创建后继续新建
        </label>
      </aside>

    </div>
    </>
  );
}
