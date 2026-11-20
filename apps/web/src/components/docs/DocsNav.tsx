"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Book, ChevronDown, ChevronRight, Clock, FileText, House, Package, Plus, Search, SquarePen, Star } from "lucide-react";
import { useConfirm } from "@/components/ui/Confirm";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { NewDocDialogHost, openNewDoc } from "./NewDocDialog";

export type DocsNavSpace = { id: string; name: string; iconUrl?: string | null };
type TreePage = { id: string; parentId: string | null; groupId: string | null; title: string; published: boolean; hasDraft: boolean };
export type DocGroup = { id: string; key: string | null; name: string; sortOrder: number };
type TreeData = { space: { id: string; name: string; key: string; iconUrl: string | null; kind?: "project" | "product" }; groups: DocGroup[]; pages: TreePage[]; canEdit: boolean };

/** 页面树需要刷新时（新建、发布、移动、删除）广播这个事件 */
export const DOCS_TREE_EVENT = "docs:tree";
export function refreshDocsTree() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DOCS_TREE_EVENT));
}

/** /docs/<spaceId>/pages/<pageId>... → { spaceId, pageId } */
export function docsLocation(pathname: string) {
  const m = pathname.match(/^\/docs\/([^/]+)(?:\/pages\/([^/]+))?/);
  const spaceId = m?.[1];
  if (!spaceId || spaceId === "recent" || spaceId === "starred" || spaceId === "home") return { spaceId: null, pageId: null };
  return { spaceId, pageId: m?.[2] ?? null };
}

/** 新建页面：在空间里直接建；不在空间里先选空间 */
export async function createDocPage(spaceId: string, parentId?: string | null, groupId?: string | null) {
  const res = await fetch("/api/docs/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId, parentId: parentId || null, groupId: parentId ? null : groupId || null }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "新建页面失败");
  return data as { id: string; projectId: string };
}

/** 「新建页面」：打开新建文档弹窗（Figma 47），按当前所在空间预填层级和所属 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留旧签名，侧栏仍按原样传入
export function DocsNewPageButton(_props: { spaces: DocsNavSpace[] }) {
  const pathname = usePathname();
  const { spaceId } = docsLocation(pathname);
  return (
    <>
      <button type="button" className="btn-secondary nv-sidebar-create" onClick={() => openNewDoc(spaceId ? { spaceId } : {})}>
        <SquarePen size={16} aria-hidden="true" />
        新建页面
      </button>
      <NewDocDialogHost onCreated={refreshDocsTree} />
    </>
  );
}

function TreeItem({
  node,
  childrenOf,
  spaceId,
  currentId,
  depth,
  openIds,
  toggle,
  canEdit,
  onAddChild,
  onNavigate,
}: {
  node: TreePage;
  childrenOf: Map<string | null, TreePage[]>;
  spaceId: string;
  currentId: string | null;
  depth: number;
  openIds: Set<string>;
  toggle: (id: string) => void;
  canEdit: boolean;
  onAddChild: (parentId: string) => void;
  onNavigate: () => void;
}) {
  const kids = childrenOf.get(node.id) || [];
  const open = openIds.has(node.id);
  const active = node.id === currentId;
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div className={`doc-tree-row${active ? " is-active" : ""}`} style={{ paddingLeft: 4 + depth * 14 }}>
        {kids.length ? (
          <button
            type="button"
            className="doc-tree-caret"
            aria-label={`${open ? "收起" : "展开"}「${node.title}」`}
            onClick={() => toggle(node.id)}
          >
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span className="doc-tree-caret" aria-hidden="true" />
        )}
        <Link
          href={`/docs/${spaceId}/pages/${node.id}`}
          className="doc-tree-link"
          aria-current={active ? "page" : undefined}
          title={node.title}
          onClick={onNavigate}
        >
          <FileText size={14} aria-hidden="true" />
          <span className={`nv-nav-label${node.published ? "" : " is-draft"}`}>{node.title}</span>
          {!node.published ? <span className="doc-tree-draft">草稿</span> : null}
        </Link>
        {canEdit ? (
          <button
            type="button"
            className="doc-tree-add"
            aria-label={`在「${node.title}」下新建子页面`}
            title="新建子页面"
            onClick={() => onAddChild(node.id)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {kids.length && open ? (
        <ul role="group">
          {kids.map((k) => (
            <TreeItem
              key={k.id}
              node={k}
              childrenOf={childrenOf}
              spaceId={spaceId}
              currentId={currentId}
              depth={depth + 1}
              openIds={openIds}
              toggle={toggle}
              canEdit={canEdit}
              onAddChild={onAddChild}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type Counts = { product: number; dev: number; project: number; other: number; total: number };
type SpaceTreeProject = { id: string; name: string; iconUrl: string | null; counts?: Counts };
/** counts 含产品下各项目的文档；spaceCounts 只算产品资料空间自己的 */
type SpaceTree = { products: { id: string; name: string; code: string; spaceId: string; projects: SpaceTreeProject[]; counts?: Counts; spaceCounts?: Counts }[]; unassigned: SpaceTreeProject[] };
type DocView = "product" | "project" | "doc";
const VIEW_KEY = "pm-doc-nav-view";
const DOC_TYPE_ROWS: { key: "product" | "dev" | "project" | "other"; label: string }[] = [
  { key: "product", label: "产品文档" },
  { key: "dev", label: "开发文档" },
  { key: "project", label: "业务文档" },
  { key: "other", label: "其他分组" },
];
/** 「产品 3 · 开发 1 · 业务 2」：只列有数量的类型 */
function countLine(c?: Counts) {
  if (!c || !c.total) return "还没有文档";
  return [`产品 ${c.product}`, `开发 ${c.dev}`, `业务 ${c.project}`, ...(c.other ? [`其他 ${c.other}`] : [])].join(" · ");
}
type DocListRow = { id: string; spaceId: string; title: string; spaceName: string; level: "product" | "project"; productName: string | null; group: string };

function useSpaceTree() {
  const [data, setData] = useState<SpaceTree | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/docs/spaces", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d))
        .catch(() => undefined);
    void load();
    window.addEventListener(DOCS_TREE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(DOCS_TREE_EVENT, load);
    };
  }, []);
  return data;
}

/** 按需加载各空间的分组和页面；展开到哪个空间才请求哪个，刷新事件时重新拉已加载过的 */
function useSpaceTrees(want: string[]) {
  const [trees, setTrees] = useState<Record<string, TreeData | null>>({});
  const loadOne = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/docs/spaces/${id}/tree`, { cache: "no-store" });
      const d = res.ok ? ((await res.json()) as TreeData) : null;
      setTrees((prev) => ({ ...prev, [id]: d }));
    } catch {
      /* 网络错误时保留上一份 */
    }
  }, []);
  const key = want.join(",");
  useEffect(() => {
    for (const id of want) if (!(id in trees)) void loadOne(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadOne]);
  useEffect(() => {
    const reload = () => {
      setTrees((prev) => {
        for (const id of Object.keys(prev)) void loadOne(id);
        return prev;
      });
    };
    window.addEventListener(DOCS_TREE_EVENT, reload);
    return () => window.removeEventListener(DOCS_TREE_EVENT, reload);
  }, [loadOne]);
  return trees;
}

const OPEN_KEY = "pm-doc-nav-open";
function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(key) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, v: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(v)));
  } catch {
    /* 存储不可用时只在本次会话生效 */
  }
}

/**
 * 文档模块的 240 侧栏（Figma 43）：全局入口 + 空间树。
 * 空间树按 产品 › 项目 展示：「产品」视图只列产品，展开是产品资料的 产品文档 / 开发文档 / 业务文档 分组，不列项目；项目（含未归属产品的）在「项目」视图里展开自己的分组。可新建自定义分组，分组里直接新建页面。
 */
export function DocsNav({ spaces, onNavigate }: { spaces: DocsNavSpace[]; onNavigate: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const loc = docsLocation(pathname);
  const pageId = loc.pageId;
  const currentSpace = loc.spaceId;
  const spaceTree = useSpaceTree();

  // 展开状态：产品 p:<id>、空间 s:<id>；分组默认展开，收起的记在 g:<id>；页面子树展开记在 n:<id>
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setOpened(readSet(OPEN_KEY));
    setReady(true);
  }, []);
  const isOpen = (k: string) => opened.has(k);
  const setOpen = (k: string, v: boolean) =>
    setOpened((prev) => {
      if (prev.has(k) === v) return prev;
      const next = new Set(prev);
      if (v) next.add(k);
      else next.delete(k);
      writeSet(OPEN_KEY, next);
      return next;
    });
  const flip = (k: string) => setOpen(k, !opened.has(k));

  // 空间区按层级展示：产品（默认）/ 项目 / 文档，记在本机
  const [view, setViewState] = useState<DocView>("product");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "project" || v === "doc") setViewState(v);
    } catch {
      /* 本机存储不可用时用默认 */
    }
  }, []);
  const setView = (v: DocView) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 忽略 */
    }
  };
  // 文档视图：展开哪个类型才读哪个类型的文档
  const [docLists, setDocLists] = useState<Record<string, DocListRow[] | null>>({});
  useEffect(() => {
    if (view !== "doc") return;
    const need = DOC_TYPE_ROWS.filter((t) => opened.has(`t:${t.key}`) && !(t.key in docLists)).map((t) => t.key);
    for (const k of need) {
      setDocLists((p) => ({ ...p, [k]: null }));
      void fetch(`/api/docs/list?type=${k}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows: DocListRow[] }) => setDocLists((p) => ({ ...p, [k]: d.rows })))
        .catch(() => setDocLists((p) => ({ ...p, [k]: [] })));
    }
  }, [view, opened, docLists]);
  useEffect(() => {
    const reset = () => setDocLists({});
    window.addEventListener(DOCS_TREE_EVENT, reset);
    return () => window.removeEventListener(DOCS_TREE_EVENT, reset);
  }, []);

  // 当前空间及其所属产品自动展开
  useEffect(() => {
    if (!ready || !currentSpace || !spaceTree) return;
    const prod = spaceTree.products.find((p) => p.spaceId === currentSpace || p.projects.some((x) => x.id === currentSpace));
    setOpened((prev) => {
      const need = [`s:${currentSpace}`, prod ? `p:${prod.id}` : spaceTree.unassigned.some((x) => x.id === currentSpace) ? "p:__unassigned__" : ""].filter(Boolean);
      if (need.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      need.forEach((k) => next.add(k));
      writeSet(OPEN_KEY, next);
      return next;
    });
  }, [ready, currentSpace, spaceTree]);

  // 需要加载的空间：展开的空间 + 当前空间
  const want = useMemo(() => {
    const ids = new Set<string>();
    if (currentSpace) ids.add(currentSpace);
    for (const k of Array.from(opened)) if (k.startsWith("s:")) ids.add(k.slice(2));
    for (const p of spaceTree?.products || []) if (opened.has(`p:${p.id}`) && p.spaceId) ids.add(p.spaceId);
    return Array.from(ids).sort();
  }, [opened, currentSpace, spaceTree]);
  const trees = useSpaceTrees(want);

  // 当前页面的祖先页面自动展开
  useEffect(() => {
    const t = currentSpace ? trees[currentSpace] : null;
    if (!t || !pageId) return;
    const byId = new Map(t.pages.map((p) => [p.id, p]));
    let cur = byId.get(pageId)?.parentId ?? null;
    let guard = 0;
    const need: string[] = [];
    while (cur && guard++ < 50) {
      need.push(`n:${cur}`);
      cur = byId.get(cur)?.parentId ?? null;
    }
    const pg = byId.get(pageId);
    let root = pg;
    while (root?.parentId && guard++ < 100) root = byId.get(root.parentId);
    if (root?.groupId) need.push(`!g:${root.groupId}`);
    if (!need.length) return;
    setOpened((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const k of need) {
        if (k.startsWith("!")) {
          if (next.delete(k.slice(1))) changed = true;
        } else if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      }
      if (!changed) return prev;
      writeSet(OPEN_KEY, next);
      return next;
    });
  }, [trees, currentSpace, pageId]);

  // 新建 / 重命名分组
  const [groupForm, setGroupForm] = useState<null | { spaceId: string; id?: string; name: string }>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");

  async function submitGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupForm || groupBusy) return;
    if (!groupForm.name.trim()) {
      setGroupError("请填写分组名称");
      return;
    }
    setGroupBusy(true);
    setGroupError("");
    const res = await fetch(`/api/docs/spaces/${groupForm.spaceId}/groups`, {
      method: groupForm.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(groupForm.id ? { groupId: groupForm.id, name: groupForm.name } : { name: groupForm.name }),
    });
    const data = await res.json().catch(() => ({}));
    setGroupBusy(false);
    if (!res.ok) {
      setGroupError(data.error || "保存失败");
      return;
    }
    toast.success(groupForm.id ? "已重命名分组" : `已新建分组「${groupForm.name.trim()}」`);
    setOpen(`s:${groupForm.spaceId}`, true);
    setGroupForm(null);
    refreshDocsTree();
  }

  async function deleteGroup(spaceId: string, g: DocGroup, count: number) {
    const ok = await confirm({
      title: `删除分组「${g.name}」？`,
      body: count ? `分组里的 ${count} 个页面会移到「业务文档」，页面本身不会删除。` : "分组是空的，删除后不能恢复。",
      confirmLabel: "删除分组",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/docs/spaces/${spaceId}/groups?groupId=${encodeURIComponent(g.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }
    toast.success(count ? `已删除分组「${g.name}」，${count} 个页面移到「业务文档」` : `已删除分组「${g.name}」`);
    refreshDocsTree();
  }

  async function addPage(spaceId: string, parentId: string | null, groupId?: string | null) {
    try {
      const page = await createDocPage(spaceId, parentId, groupId);
      if (parentId) setOpen(`n:${parentId}`, true);
      if (groupId) setOpen(`g:${groupId}`, false);
      refreshDocsTree();
      onNavigate();
      router.push(`/docs/${spaceId}/pages/${page.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建页面失败");
    }
  }

  const top = [
    { label: "主页", href: "/docs/home", Icon: House },
    { label: "最近", href: "/docs/recent", Icon: Clock },
    { label: "加星标", href: "/docs/starred", Icon: Star },
    { label: "搜索", href: "/docs/search", Icon: Search },
    { label: "所有空间", href: "/docs", Icon: Book, exact: true },
  ];
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));
  const pad = (depth: number) => ({ paddingLeft: 4 + depth * 14 });
  const caret = (open: boolean) => (open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />);

  /** 某个空间的分组和页面（产品资料空间、项目空间都用它） */
  function renderSpaceGroups(spaceId: string, depth: number) {
    const t = trees[spaceId];
    if (!t) return null;
    const childrenOf = new Map<string | null, TreePage[]>();
    for (const p of t.pages) {
      const k = p.parentId;
      if (!childrenOf.has(k)) childrenOf.set(k, []);
      childrenOf.get(k)!.push(p);
    }
    const roots = childrenOf.get(null) || [];
    // 分组后的数字含子页面，和产品 / 项目上的类型计数一致
    const subtree = (id: string, guard = 0): number => (guard > 50 ? 0 : (childrenOf.get(id) || []).reduce((n, c) => n + 1 + subtree(c.id, guard + 1), 0));
    const openIds = new Set(Array.from(opened).filter((k) => k.startsWith("n:")).map((k) => k.slice(2)));
    return (
      <>
        {t.groups.map((g) => {
          const list = roots.filter((n) => n.groupId === g.id);
          const open = !opened.has(`g:${g.id}`);
          return (
            <div key={g.id} className="doc-group">
              <div className="doc-space-row is-group" style={pad(depth)}>
                <button type="button" className="doc-space-toggle" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}「${g.name}」`} onClick={() => flip(`g:${g.id}`)}>
                  {caret(open)}
                  <span className="nv-nav-label">{g.name}</span>
                  <span className="doc-group-count">· {list.reduce((n, r) => n + 1 + subtree(r.id), 0)}</span>
                </button>
                {t.canEdit ? (
                  <span className="doc-row-acts">
                    <ActionMenu
                      label={`分组「${g.name}」更多操作`}
                      items={[
                        { label: "新建页面", onSelect: () => void addPage(spaceId, null, g.id) },
                        { label: "重命名", onSelect: () => (setGroupError(""), setGroupForm({ spaceId, id: g.id, name: g.name })) },
                        { label: "删除分组", tone: "danger", disabled: Boolean(g.key), onSelect: () => void deleteGroup(spaceId, g, list.length) },
                      ]}
                    />
                    <button type="button" className="icon-button doc-tree-root-add" aria-label={`在「${g.name}」新建页面`} title="新建页面" onClick={() => void addPage(spaceId, null, g.id)}>
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </div>
              {open && list.length ? (
                <ul className="doc-tree" role="tree" aria-label={`${t.space.name} · ${g.name}`} style={{ marginLeft: (depth + 1) * 14 }}>
                  {list.map((n) => (
                    <TreeItem
                      key={n.id}
                      node={n}
                      childrenOf={childrenOf}
                      spaceId={spaceId}
                      currentId={pageId}
                      depth={0}
                      openIds={openIds}
                      toggle={(id) => flip(`n:${id}`)}
                      canEdit={t.canEdit}
                      onAddChild={(id) => void addPage(spaceId, id)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </>
    );
  }

  /** 空间行（产品 / 项目）：箭头展开，名称进入空间概览，⋯ 里新建页面和分组 */
  function spaceMenu(spaceId: string, name: string, kind: "product" | "project") {
    const t = trees[spaceId];
    const fallback = t?.groups.find((g) => g.key === "project") || t?.groups[t.groups.length - 1];
    return (
      <ActionMenu
        label={`空间「${name}」更多操作`}
        items={[
          ...(t?.canEdit
            ? [
                { label: "新建页面", onSelect: () => void addPage(spaceId, null, fallback?.id) },
                { label: "新建分组", onSelect: () => (setGroupError(""), setGroupForm({ spaceId, name: "" })) },
              ]
            : []),
          { label: "空间概览", onSelect: () => (onNavigate(), router.push(`/docs/${spaceId}`)) },
          { label: "快捷链接", onSelect: () => (onNavigate(), router.push(`/docs/${spaceId}#links`)) },
          ...(kind === "project" ? [{ label: "打开关联项目", onSelect: () => (onNavigate(), router.push(`/projects/${spaceId}`)) }] : []),
          { label: "复制空间链接", onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}/docs/${spaceId}`) },
        ]}
      />
    );
  }

  function renderProject(p: SpaceTreeProject, depth: number, caption?: string) {
    const open = isOpen(`s:${p.id}`);
    return (
      <div key={p.id}>
        <div className={`doc-space-row is-space${currentSpace === p.id && !pageId ? " is-active" : ""}`} style={pad(depth)}>
          <button type="button" className="doc-space-caret" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}「${p.name}」`} onClick={() => flip(`s:${p.id}`)}>
            {caret(open)}
          </button>
          <Link href={`/docs/${p.id}`} className="doc-space-link" onClick={() => (setOpen(`s:${p.id}`, true), onNavigate())} aria-current={currentSpace === p.id && !pageId ? "page" : undefined}>
            <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
            <span className="nv-nav-label">{p.name}</span>
          </Link>
          {p.counts ? <span className="doc-space-count" aria-label={`${p.counts.total} 篇文档`}>{p.counts.total}</span> : null}
          <span className="doc-row-acts">{spaceMenu(p.id, p.name, "project")}</span>
        </div>
        {caption !== undefined ? (
          <p className="doc-space-sub" style={pad(depth + 2)}>
            {caption}
          </p>
        ) : null}
        {open ? renderSpaceGroups(p.id, depth + 1) : null}
      </div>
    );
  }


  /** 产品视图：产品行显示文档总数和各类型数量，展开看产品资料和项目的目录 */
  function renderProductView(tree: SpaceTree) {
    return (
      <>
        {tree.products.map((p) => {
          const open = isOpen(`p:${p.id}`);
          const active = currentSpace === p.spaceId && !pageId;
          return (
            <div key={p.id}>
              <div className={`doc-space-row is-space is-product${active ? " is-active" : ""}`} style={pad(0)}>
                <button type="button" className="doc-space-caret" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}「${p.name}」`} onClick={() => flip(`p:${p.id}`)}>
                  {caret(open)}
                </button>
                {p.spaceId ? (
                  <Link href={`/docs/${p.spaceId}`} className="doc-space-link" onClick={() => (setOpen(`p:${p.id}`, true), onNavigate())} aria-current={active ? "page" : undefined}>
                    <Package size={14} aria-hidden="true" />
                    <span className="nv-nav-label">{p.name}</span>
                  </Link>
                ) : (
                  <button type="button" className="doc-space-link" onClick={() => flip(`p:${p.id}`)}>
                    <Package size={14} aria-hidden="true" />
                    <span className="nv-nav-label">{p.name}</span>
                  </button>
                )}
                {(p.spaceCounts || p.counts) ? <span className="doc-space-count" aria-label={`${(p.spaceCounts || p.counts)!.total} 篇文档`}>{(p.spaceCounts || p.counts)!.total}</span> : null}
                {p.spaceId ? <span className="doc-row-acts">{spaceMenu(p.spaceId, p.name, "product")}</span> : null}
              </div>
              {/* 产品目录下只放产品资料的分组，不列项目（项目在「项目」视图里看） */}
              {open && p.spaceId ? renderSpaceGroups(p.spaceId, 1) : null}
            </div>
          );
        })}
      </>
    );
  }

  /** 项目视图：所有项目平铺，副标题是所属产品和各类型数量 */
  function renderProjectView(tree: SpaceTree) {
    const list = [
      ...tree.products.flatMap((p) => p.projects.map((x) => ({ x, product: p.name }))),
      ...tree.unassigned.map((x) => ({ x, product: "未归属产品" })),
    ];
    if (!list.length) return <p className="doc-space-sub">还没有项目空间。</p>;
    return <>{list.map(({ x, product }) => renderProject(x, 0, `${product} · ${countLine(x.counts)}`))}</>;
  }

  /** 文档视图：按类型汇总全部可见文档，展开列出文档，「+」按类型新建 */
  function renderDocView(tree: SpaceTree) {
    const total = { product: 0, dev: 0, project: 0, other: 0 };
    for (const p of tree.products) for (const k of DOC_TYPE_ROWS) total[k.key] += p.counts?.[k.key] || 0;
    for (const x of tree.unassigned) for (const k of DOC_TYPE_ROWS) total[k.key] += x.counts?.[k.key] || 0;
    return (
      <>
        {DOC_TYPE_ROWS.map((t) => {
          const open = isOpen(`t:${t.key}`);
          const rows = docLists[t.key];
          return (
            <div key={t.key} className="doc-group">
              <div className="doc-space-row is-group" style={pad(0)}>
                <button type="button" className="doc-space-toggle" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}「${t.label}」`} onClick={() => flip(`t:${t.key}`)}>
                  {caret(open)}
                  <span className="nv-nav-label">{t.label}</span>
                  <span className="doc-group-count">· {total[t.key]}</span>
                </button>
                <span className="doc-row-acts">
                  <button
                    type="button"
                    className="icon-button doc-tree-root-add"
                    aria-label={`新建${t.label}`}
                    title="新建文档"
                    onClick={() => openNewDoc({ spaceId: currentSpace || undefined, groupKey: t.key === "other" ? null : t.key })}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </span>
              </div>
              {open ? (
                rows === null || rows === undefined ? (
                  <p className="doc-space-sub" style={pad(2)}>
                    正在读取…
                  </p>
                ) : rows.length ? (
                  <ul className="doc-type-list" aria-label={t.label}>
                    {rows.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/docs/${r.spaceId}/pages/${r.id}`}
                          className={`doc-type-item${pageId === r.id ? " is-active" : ""}`}
                          aria-current={pageId === r.id ? "page" : undefined}
                          onClick={onNavigate}
                          title={`${r.title} · ${r.level === "product" ? r.spaceName : `${r.productName ? `${r.productName} › ` : ""}${r.spaceName}`}`}
                        >
                          <FileText size={14} aria-hidden="true" />
                          <span className="nv-nav-label">{r.title}</span>
                          <span className="doc-type-where">{t.key === "other" ? `${r.group} · ` : ""}{r.spaceName}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="doc-space-sub" style={pad(2)}>
                    还没有{t.label}
                  </p>
                )
              ) : null}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      <div className="nv-nav-list">
        {top.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`nv-nav-item${isActive(it.href, it.exact) ? " is-active" : ""}`}
            aria-current={isActive(it.href, it.exact) ? "page" : undefined}
            onClick={onNavigate}
          >
            <it.Icon size={16} aria-hidden="true" />
            <span className="nv-nav-label">{it.label}</span>
          </Link>
        ))}
      </div>

      {spaceTree && (spaceTree.products.length || spaceTree.unassigned.length) ? (
        <div className="doc-space-tree">
          <div className="nv-nav-group-head">
            <button type="button" className="nv-nav-group-label" aria-expanded={!isOpen("tree-folded")} onClick={() => flip("tree-folded")}>
              空间
              <ChevronDown size={12} aria-hidden="true" className="nv-caret" />
            </button>
          </div>
          {isOpen("tree-folded") ? null : (
            <>
              <div className="nv-pform-seg doc-view-seg" role="group" aria-label="空间按层级展示">
                {(
                  [
                    ["product", "产品"],
                    ["project", "项目"],
                    ["doc", "文档"],
                  ] as [DocView, string][]
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <nav aria-label={view === "product" ? "按产品浏览文档" : view === "project" ? "按项目浏览文档" : "按文档类型浏览"}>
                {view === "product" ? renderProductView(spaceTree) : view === "project" ? renderProjectView(spaceTree) : renderDocView(spaceTree)}
              </nav>
            </>
          )}
        </div>
      ) : spaces.length ? (
        <div className="doc-nav-space">
          <div className="nv-nav-group-head">
            <span className="nv-nav-group-label">项目空间</span>
          </div>
          <div className="nv-nav-list">
            {spaces.map((s) => (
              <Link key={s.id} href={`/docs/${s.id}`} className="nv-nav-item" onClick={onNavigate}>
                <ProjectIcon name={s.name} src={s.iconUrl} size={16} />
                <span className="nv-nav-label">{s.name}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(groupForm)}
        onClose={() => setGroupForm(null)}
        title={groupForm?.id ? "重命名分组" : "新建分组"}
        busy={groupBusy}
        dirty={Boolean(groupForm?.name && !groupForm.id)}
      >
        {groupForm ? (
          <form className="modal-form" onSubmit={submitGroup}>
            <div className="modal-form-fields">
              {groupError ? (
                <div role="alert" className="banner-error">
                  {groupError}
                </div>
              ) : null}
              <Field id="doc-group-name" label="分组名称" hint="分组用来归类空间根目录下的页面，如：设计文档、会议纪要">
                <input
                  className="input"
                  value={groupForm.name}
                  maxLength={30}
                  data-initial-focus=""
                  placeholder="如：设计文档"
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                />
              </Field>
            </div>
            <div className="modal-form-actions">
              <ModalCancelButton />
              <button type="submit" className="btn-primary" disabled={groupBusy} aria-busy={groupBusy || undefined}>
                {groupForm.id ? "保存" : "新建"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
