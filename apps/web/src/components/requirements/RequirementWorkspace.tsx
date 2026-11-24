"use client";

import { GenTitleButton } from "@/components/ui/GenTitleButton";
import { generateTitle } from "@/lib/title-gen-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { TemplateMenu } from "./TemplateMenu";
import {
  Bug,
  Calendar,
  ChevronDown,
  CircleCheck,
  Clock,
  Folder,
  Info,
  Layers,
  Link2,
  List,
  Package,
  Paperclip,
  Plus,
  Rocket,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { RichTextEditor, type RichTextHandle } from "@/components/editor/RichTextEditor";
import { PropPicker } from "@/components/ui/PropPicker";
import { DatePicker } from "@/components/ui/DatePicker";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityGlyph, REQ_GLYPH } from "@/components/ui/Glyphs";
import { BugStatusBadge, ReqStatusBadge } from "@/components/ui/StatusBadge";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { PRIORITY_LABELS, PRIORITY_OPTIONS, REQUIREMENT_ASSIGNEE_SLOTS, jobRoleLabel } from "@/lib/constants";
import { buildProductTree, type ProductTreeNode } from "@/lib/products";
import { RequirementActions } from "./RequirementActions";
import { REQUIREMENT_CREATED_EVENT } from "./NewRequirementButton";

type MetaProject = { id: string; name: string; key: string; iconUrl?: string | null; productId?: string | null };
type MetaUser = { id: string; name: string; globalRole: string; position?: string | null; avatarUrl?: string | null };
type MetaRelease = { id: string; version: string; title?: string | null; projectId: string };
type Member = { id: string; jobRole: string; user: MetaUser };
type ProductOpt = {
  id: string;
  name: string;
  code: string;
  nodes: { id: string; parentId: string | null; type: string; name: string; description: string | null; sortOrder: number }[];
};
type PoolUser = { id: string; name: string; avatarUrl?: string | null; jobRole: string };

export type ReqChild = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  owner: { name: string; avatarUrl?: string | null } | null;
  plannedEndAt: string;
};
export type ReqBugRow = { id: string; title: string; status: string; severity: string; href: string; assignee: string | null };
export type ReqFeedItem =
  | { kind: "log"; id: string; at: string; actor: { name: string; avatarUrl?: string | null } | null; message: string }
  | { kind: "comment"; id: string; at: string; actor: { id: string; name: string; avatarUrl?: string | null }; html: string };

export type RequirementWorkspaceData = {
  id?: string;
  code?: string;
  title: string;
  descriptionHtml: string;
  status: string;
  priority: string;
  assignees: Record<string, string>;
  startAt: string;
  plannedEndAt: string;
  tags: string[];
  parent: { id: string; title: string; code: string } | null;
  productId: string;
  productNodeId: string;
  projectId: string;
  releaseId: string;
  releases: { id: string; version: string }[];
  docUrl: string;
  /** 提出人（T26）：空表示按创建人 */
  proposerId?: string;
  proposer?: { name: string; avatarUrl?: string | null } | null;
  creator?: { name: string; avatarUrl?: string | null };
  createdAt?: string;
  updatedAt?: string;
  /** 乐观锁版本号：保存时带上，服务端发现已被别人改过会返回 409 */
  revision?: number;
  lastEdit?: { name: string; at: string } | null;
  children: ReqChild[];
  bugs: ReqBugRow[];
  feed: ReqFeedItem[];
};

export type RequirementWorkspacePerms = { edit: boolean; move: boolean; bug: boolean };

const DRAFT_KEY = "pm-req-draft";

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
function shortDate(v: string) {
  if (!v) return "";
  const [, m, d] = v.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 属性面板的一行：图标 + 名称 88 + 可点击的值 */
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

/** 「菜单 › 模块」树形选项（只有功能模块和功能点可选） */
function NodeOptions({
  nodes,
  value,
  onPick,
}: {
  nodes: ProductTreeNode[];
  value: string;
  onPick: (id: string) => void;
}) {
  const out: React.ReactNode[] = [];
  const walk = (list: ProductTreeNode[], depth: number) => {
    for (const n of list) {
      const pickable = n.type !== "menu";
      out.push(
        <button
          key={n.id}
          type="button"
          role="option"
          aria-selected={n.id === value}
          disabled={!pickable}
          className={pickable ? undefined : "is-group"}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => pickable && onPick(n.id)}
        >
          {n.name}
          {n.type === "feature" ? <small>功能点</small> : n.type === "menu" ? <small>菜单</small> : null}
        </button>,
      );
      walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return <>{out}</>;
}

/**
 * 需求详情（Figma 24）与新建需求全页（Figma 25）共用的工作区：
 * 左侧主内容（编号 / 大标题 / 属性胶囊 / 富文本描述 / 操作条 / 子需求 / 动态与评论），右侧 340 属性面板。
 * 详情里改动即时保存（描述失焦保存）；新建页填写后点「创建需求」，草稿自动存在本机。
 */
export function RequirementWorkspace({
  mode,
  initial,
  perms,
  lockProject = false,
  returnHref,
  projectLabel,
  currentUserId = "",
  isAdmin = false,
  flowSlot,
  docsSlot,
}: {
  /** 需求进度条（T26），显示在编号上方 */
  flowSlot?: React.ReactNode;
  /** 需求文档区块（T26），显示在子需求上方 */
  docsSlot?: React.ReactNode;
  currentUserId?: string;
  isAdmin?: boolean;
  mode: "create" | "edit";
  initial: RequirementWorkspaceData;
  perms: RequirementWorkspacePerms;
  lockProject?: boolean;
  /** 新建页「取消」回到哪里 */
  returnHref: string;
  projectLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isCreate = mode === "create";
  const canEdit = isCreate || perms.edit;
  const [v, setV] = useState<RequirementWorkspaceData>(initial);
  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [users, setUsers] = useState<MetaUser[]>([]);
  const [releases, setReleases] = useState<MetaRelease[]>([]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [parents, setParents] = useState<{ id: string; title: string }[] | null>(null);
  const [savedAt, setSavedAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keepCreating, setKeepCreating] = useState(false);
  const [tab, setTab] = useState<"all" | "comments" | "activity" | "bugs">("all");
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState(initial.docUrl);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [commentEmpty, setCommentEmpty] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const desc = useRef<RichTextHandle>(null);
  const comment = useRef<RichTextHandle>(null);
  const descDirty = useRef(false);
  const revision = useRef(initial.revision);
  const [editorKey, setEditorKey] = useState(0);

  // 详情页保存后服务端数据刷新：同步过来（正在编辑的标题保留）
  useEffect(() => {
    if (isCreate) return;
    setV((prev) => ({ ...initial, title: document.activeElement === titleRef.current ? prev.title : initial.title }));
  }, [initial, isCreate]);

  // 选项数据
  useEffect(() => {
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
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setProducts(d.products || []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // 父需求候选：项目内按项目，公共池按公共池（之前没选项目时父需求点不动）
  useEffect(() => {
    let alive = true;
    setParents(null);
    fetch(`/api/requirements?projectId=${encodeURIComponent(v.projectId || "__none__")}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setParents(d.items || []))
      .catch(() => alive && setParents([]));
    return () => {
      alive = false;
    };
  }, [v.projectId]);
  useEffect(() => {
    if (!v.projectId) {
      setMembers(null);
      return;
    }
    let alive = true;
    fetch(`/api/projects/${v.projectId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => alive && setMembers(d.members || []))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [v.projectId]);

  // 新建页：恢复 / 自动保存草稿（只存本机）
  useEffect(() => {
    if (!isCreate) return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { title?: string; descriptionHtml?: string; projectId?: string; at?: string };
      if ((d.title || d.descriptionHtml) && (!lockProject || d.projectId === initial.projectId)) {
        setV((prev) => ({ ...prev, title: d.title || "", descriptionHtml: d.descriptionHtml || "" }));
        setEditorKey((k) => k + 1);
        setSavedAt(d.at || "");
      }
    } catch {
      /* 无存储时不恢复 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isCreate) return;
    const t = window.setTimeout(() => {
      try {
        if (!v.title && !v.descriptionHtml) window.localStorage.removeItem(DRAFT_KEY);
        else {
          const at = new Date().toISOString();
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: v.title, descriptionHtml: v.descriptionHtml, projectId: v.projectId, at }));
          setSavedAt(at);
        }
      } catch {
        /* 忽略 */
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [isCreate, v.title, v.descriptionHtml, v.projectId]);

  const pool: PoolUser[] = useMemo(
    () =>
      v.projectId && members
        ? members.map((m) => ({ id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl, jobRole: m.jobRole }))
        : users.map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobRole: u.position || "member" })),
    [v.projectId, members, users],
  );
  const userOf = (id: string) => pool.find((u) => u.id === id) || users.find((u) => u.id === id);
  const project = projects.find((p) => p.id === v.projectId);
  const product = products.find((p) => p.id === v.productId);
  // 归属的项目挂了产品时，所属产品锁定为项目的产品
  const lockedProduct = projects.find((p) => p.id === v.projectId)?.productId || "";
  const productTree = useMemo(() => (product ? buildProductTree(product.nodes) : []), [product]);
  const nodePath = useMemo(() => {
    const map = new Map<string, string[]>();
    const walk = (list: ProductTreeNode[]) => list.forEach((n) => (map.set(n.id, n.path), walk(n.children)));
    walk(productTree);
    return map;
  }, [productTree]);
  const projectReleases = releases.filter((r) => r.projectId === v.projectId);

  /** 详情页：单字段即时保存 */
  const save = useCallback(
    async (patch: Record<string, unknown>, local?: Partial<RequirementWorkspaceData>) => {
      if (local) setV((prev) => ({ ...prev, ...local }));
      if (isCreate || !initial.id) return true;
      const res = await fetch(`/api/requirements/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(revision.current === undefined ? patch : { ...patch, revision: revision.current }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        // 409：别人刚改过这条需求。不刷新页面，保留正在编辑的内容，让用户自己复制后刷新
        if (res?.status === 409) {
          toast.error(`${(data as { error?: string }).error || "内容已被其他人修改"}（你这次的修改没有保存）`);
          return false;
        }
        toast.error((data as { error?: string }).error || "保存失败，请重试");
        router.refresh();
        return false;
      }
      if (typeof (data as { revision?: unknown }).revision === "number") revision.current = (data as { revision: number }).revision;
      // T43 计划联动：没开始的任务跟着平移了，给撤销
      const shifted = (data as { tasksShifted?: { count: number; days: number } }).tasksShifted;
      if (shifted?.count) {
        toast.success(`${shifted.count} 个未开始的任务一起${shifted.days > 0 ? "后移" : "提前"} ${Math.abs(shifted.days)} 天`, {
          label: "撤销",
          onClick: () => {
            void fetch(`/api/requirements/${initial.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unshift", days: -shifted.days }) }).then(() => router.refresh());
          },
        });
      }
      setSavedAt(new Date().toISOString());
      router.refresh();
      return true;
    },
    [isCreate, initial.id, router, toast],
  );

  function setAssignee(slot: string, id: string) {
    const assignees = { ...v.assignees, [slot]: id };
    void save({ assignees: { [slot]: id || null } }, { assignees });
  }

  async function saveDescription() {
    if (isCreate || !descDirty.current) return;
    descDirty.current = false;
    // 没保存成功（冲突或网络）时保留「有未保存的修改」，下次失焦再试
    if (!(await save({ descriptionHtml: desc.current?.getHtml() ?? "" }))) descDirty.current = true;
  }

  function changeProject(pid: string) {
    // 级联：项目挂了产品时，所属产品跟随项目（功能模块不属于该产品时清空）
    const forced = projects.find((p) => p.id === pid)?.productId || "";
    setV((prev) => ({
      ...prev,
      projectId: pid,
      releaseId: "",
      assignees: {},
      parent: null,
      ...(forced && forced !== prev.productId ? { productId: forced, productNodeId: "" } : {}),
    }));
    if (!isCreate) void save({ projectId: pid || null });
  }

  function addTag() {
    const t = tagDraft.trim();
    if (!t || v.tags.includes(t)) return setTagDraft("");
    const tags = [...v.tags, t];
    setTagDraft("");
    void save({ tags }, { tags });
  }
  function removeTag(t: string) {
    const tags = v.tags.filter((x) => x !== t);
    void save({ tags }, { tags });
  }

  async function create() {
    if (busy) return;
    let title = v.title.trim();
    setBusy(true);
    // 没填标题时按描述自动生成
    const descNow = desc.current?.getHtml() ?? v.descriptionHtml;
    if (!title && descNow) {
      title = (await generateTitle(descNow, "requirement")).title;
      if (title) setV((prev) => ({ ...prev, title }));
    }
    if (!title) {
      setBusy(false);
      setError("请填写需求标题");
      titleRef.current?.focus();
      return;
    }
    if (!v.projectId) {
      setBusy(false);
      setError("请选择所属项目");
      return;
    }
    setError("");
    const itr = v.tags.find((t) => t.startsWith("ITR:"));
    const res = await fetch("/api/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        descriptionHtml: desc.current?.getHtml() ?? v.descriptionHtml,
        projectId: v.projectId || null,
        priority: v.priority,
        assignees: v.assignees,
        startAt: v.startAt || null,
        plannedEndAt: v.plannedEndAt || null,
        tags: v.tags.filter((t) => t !== itr),
        itrNo: itr ? itr.slice(4) : null,
        parentId: v.parent?.id || null,
        productRefId: v.productId || null,
        productNodeId: v.productNodeId || null,
        releaseId: v.releaseId || null,
        docUrl: v.docUrl || null,
        proposerId: v.proposerId || null,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError((data as { error?: string }).error || "网络异常，结果未确认。请稍后在列表中核对后再决定是否重试。");
      return;
    }
    const id = (data as { id?: string }).id;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 忽略 */
    }
    if (id) window.dispatchEvent(new CustomEvent(REQUIREMENT_CREATED_EVENT, { detail: { id } }));
    toast.show({
      tone: "success",
      message: `已创建「${title.length > 24 ? `${title.slice(0, 24)}…` : title}」`,
      action: id ? { label: "查看", onClick: () => router.push(`/requirements/${id}`) } : undefined,
    });
    if (keepCreating) {
      // 继续新建：保留项目、负责人、产品结构等，清空标题和描述
      setV((prev) => ({ ...prev, title: "", descriptionHtml: "", parent: prev.parent }));
      desc.current?.clear();
      titleRef.current?.focus();
      setSavedAt("");
    } else if (id) {
      router.push(`/requirements/${id}`);
    }
    router.refresh();
  }

  async function addChild() {
    const title = childTitle.trim();
    if (!title || busy || !initial.id) return;
    setBusy(true);
    const res = await fetch("/api/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: v.projectId || null, parentId: initial.id, productRefId: v.productId || null, productNodeId: v.productNodeId || null }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return toast.error((data as { error?: string }).error || "添加失败，请重试");
    setChildTitle("");
    toast.success("子需求已添加");
    router.refresh();
  }

  async function submitComment() {
    const html = comment.current?.getHtml() || "";
    if (!html || commenting || !initial.id) return;
    setCommenting(true);
    const res = await fetch(`/api/requirements/${initial.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: html }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setCommenting(false);
    if (!res?.ok) return toast.error((data as { error?: string }).error || "评论失败，内容已保留");
    comment.current?.clear();
    router.refresh();
  }

  async function deleteComment(id: string) {
    if (!(await confirm({ title: "删除这条评论？", body: "删除后不能恢复。", confirmLabel: "删除", tone: "danger" }))) return;
    const res = await fetch(`/api/requirements/${initial.id}/comments/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("删除失败，请重试");
    router.refresh();
  }

  const ReqIcon = REQ_GLYPH[v.status] || REQ_GLYPH["req_in_progress"];
  const doneChildren = v.children.filter((c) => c.status === "online").length;
  const comments = v.feed.filter((f) => f.kind === "comment");
  const logs = v.feed.filter((f) => f.kind === "log");
  const feed = tab === "comments" ? comments : tab === "activity" ? logs : tab === "all" ? v.feed : [];

  /* ---------------- 属性控件（胶囊与面板共用） ---------------- */

  const statusCtl = (pill: boolean) =>
    isCreate ? (
      <span className={pill ? "nv-prop is-static" : "rq-val is-static"} title="新需求从「需求中」开始">
        <ReqIcon size={14} aria-hidden="true" />
        需求中
      </span>
    ) : (
      <RequirementActions id={initial.id!} title={v.title} status={v.status} projectId={v.projectId || null} canMove={perms.move} canEdit={false} part="status" />
    );

  const priorityCtl = (pill: boolean) => (
    <PropPicker
      className={pill ? "nv-prop" : "rq-val"}
      disabled={!canEdit}
      icon={<PriorityGlyph priority={v.priority} />}
      label={`${v.priority.toUpperCase()} ${PRIORITY_LABELS[v.priority]?.label || ""}`}
      active
      ariaLabel="优先级"
      width={160}
    >
      {(close) =>
        PRIORITY_OPTIONS.map((p) => (
          <button key={p} type="button" role="option" aria-selected={p === v.priority} onClick={() => (void save({ priority: p }, { priority: p }), close())}>
            <PriorityGlyph priority={p} />
            {p.toUpperCase()} · {PRIORITY_LABELS[p].label}
          </button>
        ))
      }
    </PropPicker>
  );

  const userPicker = (slot: string, pill: boolean, placeholder: string) => {
    const u = userOf(v.assignees[slot] || "");
    return (
      <PropPicker
        className={pill ? "nv-prop" : "rq-val"}
        disabled={!canEdit}
        icon={u ? <Avatar name={u.name} src={u.avatarUrl} size={16} /> : pill ? <UserRound size={14} aria-hidden="true" /> : null}
        label={u?.name || placeholder}
        active={Boolean(u)}
        ariaLabel={REQUIREMENT_ASSIGNEE_SLOTS.find((s) => s.key === slot)?.label}
        width={220}
      >
        {(close) => (
          <>
            <button type="button" role="option" aria-selected={!u} onClick={() => (setAssignee(slot, ""), close())}>
              未指定
            </button>
            {pool.length === 0 ? <p className="nv-prop-empty">{v.projectId ? "该项目还没有成员" : "正在加载…"}</p> : null}
            {pool.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={p.id === u?.id} onClick={() => (setAssignee(slot, p.id), close())}>
                <Avatar name={p.name} src={p.avatarUrl} size={16} />
                {p.name}
                <small>{jobRoleLabel(p.jobRole)}</small>
              </button>
            ))}
          </>
        )}
      </PropPicker>
    );
  };

  const proposer = users.find((u) => u.id === (v.proposerId || "")) || (v.proposerId && v.proposerId === initial.proposerId && initial.proposer ? { id: v.proposerId, name: initial.proposer.name, avatarUrl: initial.proposer.avatarUrl, globalRole: "", position: "" } : null);
  const proposerPicker = (
    <PropPicker
      className="rq-val"
      disabled={!canEdit}
      icon={proposer ? <Avatar name={proposer.name} src={proposer.avatarUrl} size={16} /> : null}
      label={proposer?.name || (isCreate ? "我" : `${initial.creator?.name || "创建人"}（创建人）`)}
      active={Boolean(proposer)}
      ariaLabel="提出人"
      width={240}
    >
      {(close) => (
        <>
          <button type="button" role="option" aria-selected={!proposer} onClick={() => (void save({ proposerId: null }, { proposerId: "" }), close())}>
            同创建人
          </button>
          {users.length === 0 ? <p className="nv-prop-empty">正在加载…</p> : null}
          {users.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={p.id === proposer?.id} onClick={() => (void save({ proposerId: p.id }, { proposerId: p.id }), close())}>
              <Avatar name={p.name} src={p.avatarUrl} size={16} />
              {p.name}
              <small>{p.position || ""}</small>
            </button>
          ))}
        </>
      )}
    </PropPicker>
  );

  const dateCtl = (key: "startAt" | "plannedEndAt") => (
    <DatePicker
      variant="pill"
      value={v[key]}
      disabled={!canEdit}
      onChange={(d) => void save({ [key]: d || null }, { [key]: d })}
      placeholder={key === "startAt" ? "开始日期" : "截止日期"}
      ariaLabel={key === "startAt" ? "开始日期" : "截止日期"}
    />
  );

  return (
    <div className="rq">
      <div className="rq-main">
        <div className="rq-inner">
          {flowSlot}
          <div className="rq-code">
            {isCreate ? `新需求 · ${project?.name || projectLabel || "未选项目"}` : initial.code}
            {isCreate ? (
              <TemplateMenu
                kind="requirement"
                projectId={v.projectId}
                current={() => ({ priority: v.priority, assignees: v.assignees, tags: v.tags, productId: v.productId, productNodeId: v.productNodeId, descriptionHtml: desc.current?.getHtml() ?? v.descriptionHtml })}
                onApply={(d) => {
                  setV((prev) => ({
                    ...prev,
                    ...(typeof d.priority === "string" && d.priority ? { priority: d.priority } : {}),
                    ...(d.assignees && typeof d.assignees === "object" ? { assignees: d.assignees as Record<string, string> } : {}),
                    ...(Array.isArray(d.tags) ? { tags: d.tags as string[] } : {}),
                    ...(typeof d.productId === "string" ? { productId: d.productId, productNodeId: String(d.productNodeId || "") } : {}),
                    ...(typeof d.descriptionHtml === "string" && d.descriptionHtml ? { descriptionHtml: d.descriptionHtml } : {}),
                  }));
                  if (typeof d.descriptionHtml === "string" && d.descriptionHtml) setEditorKey((k) => k + 1);
                }}
              />
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
            placeholder="需求标题"
            aria-label="需求标题（必填）"
            aria-invalid={error === "请填写需求标题" || undefined}
            autoFocus={isCreate}
            onChange={(e) => {
              setV((prev) => ({ ...prev, title: e.target.value.replace(/\n/g, "") }));
              if (error) setError("");
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
            onBlur={() => {
              const t = v.title.trim();
              if (!isCreate && t && t !== initial.title) void save({ title: t });
              if (!isCreate && !t) setV((prev) => ({ ...prev, title: initial.title }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if ((e.metaKey || e.ctrlKey) && isCreate) void create();
                else desc.current?.focus();
              }
            }}
          />
          {canEdit ? (
            <GenTitleButton
              kind="requirement"
              getHtml={() => desc.current?.getHtml() ?? v.descriptionHtml}
              onTitle={(t) => {
                setV((prev) => ({ ...prev, title: t }));
                if (error) setError("");
                if (!isCreate && t !== initial.title) void save({ title: t });
              }}
            />
          ) : null}
          </div>
          {error ? (
            <p className="nv-create-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="rq-props" role="group" aria-label="需求属性">
            {statusCtl(true)}
            {priorityCtl(true)}
            {userPicker("product", true, "添加负责人")}
            {dateCtl("startAt")}
            {dateCtl("plannedEndAt")}
          </div>

          <div
            className="rq-desc"
            onBlur={(e) => {
              // 描述失焦保存（焦点移到工具栏等内部元素时不算）
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void saveDescription();
            }}
          >
            {canEdit ? (
              <RichTextEditor
                key={editorKey}
                ref={desc}
                ariaLabel="需求描述"
                variant="full"
                initialHtml={v.descriptionHtml}
                placeholder="补充背景、目标与验收标准。可直接粘贴截图或拖入图片。"
                onChange={(html) => {
                  descDirty.current = true;
                  if (isCreate) setV((prev) => ({ ...prev, descriptionHtml: html }));
                }}
                onSubmit={isCreate ? () => void create() : () => void saveDescription()}
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
            {isCreate
              ? "可粘贴截图、拖入图片；⌘ Enter 创建"
              : v.lastEdit
                ? `最后编辑 ${v.lastEdit.name} · ${relTime(v.lastEdit.at)}`
                : "描述失焦后自动保存"}
          </p>

          <div className="rq-actbar">
            {!isCreate && canEdit ? (
              <button type="button" className="rq-act" onClick={() => setAddingChild(true)}>
                <Plus size={14} aria-hidden="true" />
                添加子需求
              </button>
            ) : null}
            {!isCreate && perms.bug && v.projectId ? (
              <Link href={`/bugs/new?requirement=${initial.id}`} className="rq-act" title="新建 Bug，自动带上本需求和功能模块">
                <Bug size={14} aria-hidden="true" />
                关联 Bug
              </Link>
            ) : null}
            {canEdit ? (
              <div className="nv-prop-wrap">
                <button type="button" className="rq-act" aria-expanded={linkOpen} onClick={() => setLinkOpen((o) => !o)}>
                  <Link2 size={14} aria-hidden="true" />
                  {v.docUrl ? "需求文档" : "添加链接"}
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
                    <input className="input" autoFocus type="url" value={linkDraft} placeholder="https://（飞书文档、原型等）" aria-label="需求文档链接" onChange={(e) => setLinkDraft(e.target.value)} />
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
                打开文档 ↗
              </a>
            ) : null}
          </div>

          {docsSlot}
          {!isCreate ? (
            <section className="rq-sub" aria-labelledby="rq-sub-title">
              <div className="rq-sub-head">
                <h2 id="rq-sub-title">
                  子需求 <span className="rq-count">{v.children.length}</span>
                </h2>
                {v.children.length ? (
                  <span className="rq-progress">
                    <CircleCheck size={14} aria-hidden="true" />
                    {doneChildren}/{v.children.length} 完成
                  </span>
                ) : null}
                <span className="flex-1" />
                {canEdit ? (
                  <button type="button" className="icon-button" aria-label="添加子需求" title="添加子需求" onClick={() => setAddingChild(true)}>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {v.children.length || addingChild ? (
                <ul className="rq-sub-list">
                  {v.children.map((c) => (
                    <li key={c.id}>
                      <span className="rq-sub-code">{c.code}</span>
                      <Link href={`/requirements/${c.id}`} className="rq-sub-title" title={c.title}>
                        {c.title}
                      </Link>
                      <ReqStatusBadge status={c.status} size="small" />
                      <span className="rq-sub-pri" title={PRIORITY_LABELS[c.priority]?.label}>
                        <PriorityGlyph priority={c.priority} />
                      </span>
                      {c.owner ? <Avatar name={c.owner.name} src={c.owner.avatarUrl} size={16} /> : <UserRound size={14} aria-hidden="true" className="rq-muted" />}
                      <span className="rq-sub-date">{c.plannedEndAt ? shortDate(c.plannedEndAt) : "—"}</span>
                    </li>
                  ))}
                  {addingChild ? (
                    <li>
                      <form
                        className="rq-sub-add"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void addChild();
                        }}
                      >
                        <input
                          className="input"
                          autoFocus
                          value={childTitle}
                          maxLength={200}
                          placeholder="子需求标题，回车添加；Esc 结束"
                          aria-label="子需求标题"
                          onChange={(e) => setChildTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setAddingChild(false);
                              setChildTitle("");
                            }
                          }}
                        />
                        <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
                          添加
                        </button>
                        <button type="button" className="btn-secondary nv-head-btn" onClick={() => (setAddingChild(false), setChildTitle(""))}>
                          完成
                        </button>
                      </form>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          ) : null}

          {!isCreate ? (
            <section className="rq-feed" aria-label="动态与评论">
              <div className="rq-tabs" role="tablist" aria-label="动态与评论">
                {(
                  [
                    ["all", "全部"],
                    ["comments", `评论${comments.length ? ` ${comments.length}` : ""}`],
                    ["activity", "动态"],
                    ["bugs", `Bug${v.bugs.length ? ` ${v.bugs.length}` : ""}`],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rq-tab${tab === k ? " is-active" : ""}`} onClick={() => setTab(k)}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "bugs" ? (
                v.bugs.length ? (
                  <ul className="detail-list">
                    {v.bugs.map((b) => (
                      <li key={b.id}>
                        <Link href={b.href} className="min-w-0 flex-1 truncate text-link" title={b.title}>
                          {b.title}
                        </Link>
                        <span className="shrink-0 text-xs text-neutral-500">{b.severity}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{b.assignee || "未指派"}</span>
                        <BugStatusBadge status={b.status} size="small" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rq-muted rq-feed-empty">暂无关联 Bug。</p>
                )
              ) : (
                <>
                  {tab !== "activity" ? (
                    <RichTextEditor
                      ref={comment}
                      ariaLabel="评论"
                      variant="compact"
                      toolbar="bottom"
                      ownerType="comment"
                      placeholder="添加评论，可粘贴图片"
                      onChange={(html) => setCommentEmpty(!html)}
                      onSubmit={() => void submitComment()}
                      toolbarEnd={
                        <button type="button" className="btn-primary nv-head-btn" disabled={commentEmpty || commenting} onClick={() => void submitComment()}>
                          {commenting ? "发送中…" : "评论"}
                        </button>
                      }
                    />
                  ) : null}
                  <ol className="rq-feed-list">
                    {feed.length === 0 ? <li className="rq-muted rq-feed-empty">{tab === "comments" ? "还没有评论。" : "暂无动态。"}</li> : null}
                    {feed.map((f) =>
                      f.kind === "log" ? (
                        <li key={`l-${f.id}`} className="rq-log">
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
                            <button type="button" className="icon-button rq-comment-del" aria-label="删除评论" title="删除评论" onClick={() => void deleteComment(f.id)}>
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                            ) : null}
                          </div>
                          <div className="doc-content rq-comment-body" dangerouslySetInnerHTML={{ __html: f.html }} />
                        </li>
                      ),
                    )}
                  </ol>
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>

      <aside className="rq-panel" aria-label="需求属性">
        <div className="rq-panel-head">
          <h2>属性</h2>
          <span suppressHydrationWarning>{isCreate ? (savedAt ? "草稿已保存" : "未保存") : savedAt ? `${relTime(savedAt)}更新` : v.updatedAt ? `${relTime(v.updatedAt)}更新` : ""}</span>
        </div>

        <Group title="详情">
          <PropRow icon={<CircleCheck size={14} aria-hidden="true" />} label="状态">
            {statusCtl(false)}
          </PropRow>
          <PropRow icon={<Info size={14} aria-hidden="true" />} label="优先级">
            {priorityCtl(false)}
          </PropRow>
          <PropRow icon={<UserRound size={14} aria-hidden="true" />} label="提出人">
            {proposerPicker}
          </PropRow>
          <PropRow icon={<UserRound size={14} aria-hidden="true" />} label="负责人">
            {userPicker("product", false, "添加负责人")}
          </PropRow>
          {REQUIREMENT_ASSIGNEE_SLOTS.filter((s) => s.key !== "product").map((s) => (
            <PropRow key={s.key} icon={<UserRound size={14} aria-hidden="true" />} label={s.label.replace("负责人", "")}>
              {userPicker(s.key, false, "未指定")}
            </PropRow>
          ))}
          <PropRow icon={<Calendar size={14} aria-hidden="true" />} label="开始日期">
            {dateCtl("startAt")}
          </PropRow>
          <PropRow icon={<Calendar size={14} aria-hidden="true" />} label="截止日期">
            {dateCtl("plannedEndAt")}
          </PropRow>
          <PropRow icon={<Tag size={14} aria-hidden="true" />} label="标签">
            <span
              className={`rq-tags${canEdit ? " is-editable" : ""}`}
              onClick={(e) => {
                if (canEdit && !(e.target as HTMLElement).closest("button")) tagInputRef.current?.focus();
              }}
            >
              {v.tags.map((t) => (
                <span key={t} className="nv-tag">
                  {t}
                  {canEdit ? (
                    <button type="button" aria-label={`移除标签 ${t}`} onClick={() => removeTag(t)}>
                      <X size={10} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
              {canEdit ? (
                <input
                  ref={tagInputRef}
                  className="rq-tag-input"
                  value={tagDraft}
                  maxLength={30}
                  placeholder={v.tags.length ? "+" : "添加标签"}
                  aria-label="添加标签，回车确认"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={addTag}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
              ) : null}
            </span>
          </PropRow>
          <PropRow icon={<List size={14} aria-hidden="true" />} label="父需求">
            <PropPicker
              className="rq-val"
              disabled={!canEdit}
              label={v.parent ? `${v.parent.code ? `${v.parent.code} ` : ""}${v.parent.title}` : "添加父需求"}
              active={Boolean(v.parent)}
              ariaLabel="父需求"
              width={300}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!v.parent} onClick={() => (void save({ parentId: null }, { parent: null }), close())}>
                    无父需求
                  </button>
                  {parents === null ? <p className="nv-prop-empty">正在加载…</p> : null}
                  {parents && !parents.filter((p) => p.id !== initial.id).length ? <p className="nv-prop-empty">{v.projectId ? "这个项目还没有其他需求" : "公共池还没有其他需求"}</p> : null}
                  {(parents || [])
                    .filter((p) => p.id !== initial.id)
                    .slice(0, 100)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={p.id === v.parent?.id}
                        onClick={() => (void save({ parentId: p.id }, { parent: { id: p.id, title: p.title, code: "" } }), close())}
                      >
                        <span className="truncate">{p.title}</span>
                      </button>
                    ))}
                </>
              )}
            </PropPicker>
          </PropRow>
        </Group>

        <Group title="产品结构">
          <PropRow icon={<Package size={14} aria-hidden="true" />} label="所属产品">
            <PropPicker
              className="rq-val"
              disabled={!canEdit || Boolean(lockedProduct)}
              label={(lockedProduct ? products.find((p) => p.id === lockedProduct)?.name : product?.name) || "选择产品"}
              active={Boolean(product || lockedProduct)}
              ariaLabel={lockedProduct ? "所属产品（跟随项目）" : "所属产品"}
              width={240}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!v.productId} onClick={() => (void save({ productRefId: null, productNodeId: null }, { productId: "", productNodeId: "" }), close())}>
                    不关联产品
                  </button>
                  {products.length === 0 ? <p className="nv-prop-empty">还没有产品，可在「产品」里新建</p> : null}
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === v.productId}
                      onClick={() => (void save({ productRefId: p.id, productNodeId: null }, { productId: p.id, productNodeId: "" }), close())}
                    >
                      <Package size={14} aria-hidden="true" />
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
              title={product ? undefined : "先选择产品"}
              label={v.productNodeId ? nodePath.get(v.productNodeId)?.join(" › ") || "已选模块" : "选择菜单 / 模块"}
              active={Boolean(v.productNodeId)}
              ariaLabel="功能模块"
              width={280}
            >
              {(close) => (
                <>
                  <button type="button" role="option" aria-selected={!v.productNodeId} onClick={() => (void save({ productNodeId: null }, { productNodeId: "" }), close())}>
                    不指定模块
                  </button>
                  {productTree.length === 0 ? <p className="nv-prop-empty">该产品还没有功能结构</p> : null}
                  <NodeOptions nodes={productTree} value={v.productNodeId} onPick={(id) => (void save({ productNodeId: id }, { productNodeId: id }), close())} />
                </>
              )}
            </PropPicker>
          </PropRow>
        </Group>

        <Group title="项目与发版">
          <PropRow icon={<Folder size={14} aria-hidden="true" />} label="项目">
            <PropPicker
              className="rq-val"
              disabled={!canEdit || lockProject}
              title={lockProject ? "在项目内新建，归属已锁定" : undefined}
              icon={project ? <ProjectIcon name={project.name} src={project.iconUrl} size={16} /> : null}
              label={project?.name || projectLabel || (isCreate ? "选择项目" : "未归属项目")}
              active={Boolean(project)}
              ariaLabel="所属项目"
              width={240}
            >
              {(close) => (
                <>
                  {projects.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected={p.id === v.projectId} onClick={() => (changeProject(p.id), close())}>
                      <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                      {p.name}
                    </button>
                  ))}
                </>
              )}
            </PropPicker>
          </PropRow>
          <PropRow icon={<Rocket size={14} aria-hidden="true" />} label="发版">
            {isCreate ? (
              <PropPicker
                className="rq-val"
                disabled={!v.projectId}
                title={v.projectId ? "放进本项目规划中的版本" : "先选择项目"}
                label={projectReleases.find((r) => r.id === v.releaseId) ? `v${projectReleases.find((r) => r.id === v.releaseId)!.version}` : "选择版本"}
                active={Boolean(v.releaseId)}
                ariaLabel="发版"
                width={220}
              >
                {(close) => (
                  <>
                    <button type="button" role="option" aria-selected={!v.releaseId} onClick={() => (setV((p) => ({ ...p, releaseId: "" })), close())}>
                      暂不放入版本
                    </button>
                    {projectReleases.length === 0 ? <p className="nv-prop-empty">本项目没有规划中的版本</p> : null}
                    {projectReleases.map((r) => (
                      <button key={r.id} type="button" role="option" aria-selected={r.id === v.releaseId} onClick={() => (setV((p) => ({ ...p, releaseId: r.id })), close())}>
                        <Rocket size={14} aria-hidden="true" />v{r.version}
                        {r.title ? <small>{r.title}</small> : null}
                      </button>
                    ))}
                  </>
                )}
              </PropPicker>
            ) : v.releases.length ? (
              <span className="rq-val is-static">
                {v.releases.map((r, i) => (
                  <span key={r.id}>
                    {i ? "、" : ""}
                    <Link href={`/releases/${r.id}`} className="text-link">
                      v{r.version}
                    </Link>
                  </span>
                ))}
              </span>
            ) : (
              <span className="rq-val is-static rq-muted">未加入发版</span>
            )}
          </PropRow>
        </Group>

        {isCreate ? (
          <label className="nv-switch rq-keep">
            <input type="checkbox" checked={keepCreating} onChange={(e) => setKeepCreating(e.target.checked)} />
            <span aria-hidden="true" />
            创建后继续新建
          </label>
        ) : (
          <div className="rq-meta">
            <p>
              <UserRound size={14} aria-hidden="true" />
              创建者 {v.creator?.name || "—"}
            </p>
            <p suppressHydrationWarning>
              <Clock size={14} aria-hidden="true" />
              创建于 {stamp(v.createdAt)}
            </p>
            <p suppressHydrationWarning>
              <Clock size={14} aria-hidden="true" />
              更新于 {stamp(v.updatedAt)}
            </p>
          </div>
        )}
      </aside>

      {isCreate ? (
        <RequirementCreateHeaderSlot>
          <span suppressHydrationWarning className="rq-draft">{savedAt ? `草稿已自动保存 · ${relTime(savedAt)}` : ""}</span>
          <Link href={returnHref} className="btn-secondary nv-head-btn">
            取消
          </Link>
          <button type="button" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined} onClick={() => void create()}>
            {busy ? "创建中…" : "创建需求"}
          </button>
        </RequirementCreateHeaderSlot>
      ) : null}

    </div>
  );
}

/** 新建页把「取消 / 创建需求」放进页头右侧（页头在服务端渲染，按钮在这里渲染后用 portal 挂过去） */
function RequirementCreateHeaderSlot({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById("rq-head-actions")), []);
  if (!host) return null;
  return createPortal(children, host);
}
