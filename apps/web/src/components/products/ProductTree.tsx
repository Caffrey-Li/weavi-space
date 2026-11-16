"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, ChevronDown, ChevronRight, CircleCheck, Folder, Layers, Plus, Search, Sparkle, Trash2, X } from "lucide-react";
import { ProductEnvButton } from "./ProductEnvButton";
import { StructureGenModal } from "./StructureGenModal";
import type { ProductEnv } from "@/lib/product-envs";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu, type ActionItem } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { ReqStatusBadge } from "@/components/ui/StatusBadge";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { PRODUCT_NODE_TYPES, buildProductTree, canNest, productNodeTypeLabel, type ProductTreeNode } from "@/lib/products";

export type TreeRow = {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  code: string | null;
  ownerId: string | null;
  description: string | null;
  sortOrder: number;
  reqCount: number;
};
export type NodeReq = { id: string; code: string; title: string; status: string };
type Owner = { id: string; name: string; avatarUrl?: string | null };

type Adding = { parentId: string | null; type: string; name: string };
type Draft = { name: string; type: string; parentId: string; code: string; ownerId: string; description: string };

const TYPE_ICON = { menu: Folder, module: Layers, feature: CircleCheck } as const;
/** 类型标签（Figma 27）：只有「模块」用强调色，菜单和功能点是中性标签 */
const TYPE_TONE: Record<string, string> = { menu: "is-neutral", module: "is-info", feature: "is-neutral" };
const TYPE_SHORT: Record<string, string> = { menu: "菜单", module: "模块", feature: "功能点" };

/**
 * 产品功能结构（Figma 27）：功能区（搜索、全部展开、新增模块、新增菜单）→ 层级说明 → 树表 + 右侧 340 编辑面板。
 * 行内「+」加子级，新增时行内输入 Enter 保存 / Esc 取消；选中行在右侧改名称、类型、上级、编码、负责人、描述。
 */
export function ProductTree({
  productId,
  rows,
  owners,
  reqsByNode,
  canManage,
  productName = "",
  envs = [],
}: {
  productName?: string;
  envs?: ProductEnv[];
  productId: string;
  rows: TreeRow[];
  owners: Owner[];
  reqsByNode: Record<string, NodeReq[]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [genOpen, setGenOpen] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const tree = useMemo(() => buildProductTree(rows), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const ownerOf = (id?: string | null) => (id ? owners.find((o) => o.id === id) : undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const node = selected ? byId.get(selected) : undefined;
  useEffect(() => {
    if (!node) return setDraft(null);
    setDraft({
      name: node.name,
      type: node.type,
      parentId: node.parentId || "",
      code: node.code || "",
      ownerId: node.ownerId || "",
      description: node.description || "",
    });
  }, [node]);

  const total = (n: ProductTreeNode): number => n.reqCount + n.children.reduce((s, c) => s + total(c), 0);
  const nodeOf = (id: string): ProductTreeNode | undefined => {
    let hit: ProductTreeNode | undefined;
    const walk = (l: ProductTreeNode[]) => l.forEach((n) => (n.id === id ? (hit = n) : walk(n.children)));
    walk(tree);
    return hit;
  };

  // 搜索：命中节点及其祖先都显示
  const visible = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return null;
    const keep = new Set<string>();
    for (const r of rows) {
      if (r.name.toLowerCase().includes(key) || (r.code || "").toLowerCase().includes(key)) {
        for (let cur: TreeRow | undefined = r; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) keep.add(cur.id);
      }
    }
    return keep;
  }, [q, rows, byId]);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      toast.error((data as { error?: string }).error || "操作失败，请重试");
      return null;
    }
    router.refresh();
    return data as Record<string, unknown>;
  }

  async function saveAdd() {
    if (!adding || busy) return;
    const name = adding.name.trim();
    if (!name) return setAdding(null);
    const ok = await call(`/api/products/${productId}/nodes`, "POST", { parentId: adding.parentId, type: adding.type, name });
    if (ok) {
      if (adding.parentId) setCollapsed((s) => (s.delete(adding.parentId!), new Set(s)));
      // 连续录入：留在同一位置继续加
      setAdding({ ...adding, name: "" });
    }
  }

  async function saveDraft() {
    if (!node || !draft || busy) return;
    if (!draft.name.trim()) return toast.error("请填写名称");
    const body: Record<string, unknown> = {
      name: draft.name,
      code: draft.code,
      ownerId: draft.ownerId || null,
      description: draft.description,
    };
    if (draft.type !== node.type) body.type = draft.type;
    if ((draft.parentId || null) !== node.parentId) body.parentId = draft.parentId || null;
    if (await call(`/api/products/${productId}/nodes/${node.id}`, "PATCH", body)) toast.success("已保存");
  }

  async function remove(id: string) {
    const n = byId.get(id);
    const t = nodeOf(id);
    if (!n || !t) return;
    if (t.children.length) return toast.error(`「${n.name}」下还有 ${t.children.length} 个下级，请先移走或删除`);
    if (n.reqCount) return toast.error(`「${n.name}」关联了 ${n.reqCount} 条需求，请先把它们改到其他模块`);
    const yes = await confirm({ title: `删除「${n.name}」？`, body: "此操作不能撤销。", confirmLabel: "删除", tone: "danger" });
    if (!yes) return;
    if (await call(`/api/products/${productId}/nodes/${id}`, "DELETE")) {
      toast.success(`已删除「${n.name}」`);
      if (selected === id) setSelected(null);
    }
  }

  function startAdd(parentId: string | null, type: string) {
    setAdding({ parentId, type, name: "" });
    if (parentId) setCollapsed((s) => (s.delete(parentId), new Set(s)));
  }

  const allIds = rows.filter((r) => rows.some((c) => c.parentId === r.id)).map((r) => r.id);
  const allOpen = collapsed.size === 0;

  /** 上级候选：同一产品里能放下当前类型、且不是自己或自己的下级 */
  const parentOptions = useMemo(() => {
    if (!node || !draft) return [];
    const banned = new Set<string>([node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) {
        if (r.parentId && banned.has(r.parentId) && !banned.has(r.id)) {
          banned.add(r.id);
          grew = true;
        }
      }
    }
    const out: { id: string; label: string }[] = [];
    const walk = (l: ProductTreeNode[]) =>
      l.forEach((n) => {
        if (!banned.has(n.id) && canNest(n.type, draft.type)) out.push({ id: n.id, label: n.path.join(" › ") });
        walk(n.children);
      });
    walk(tree);
    return out;
  }, [node, draft, rows, tree]);

  function addRow(depth: number) {
    if (!adding) return null;
    const Icon = TYPE_ICON[adding.type as keyof typeof TYPE_ICON] || Box;
    return (
      <div className="nv-ptree-row is-adding">
        <span className="nv-ptree-name">
          <span className="nv-ptree-indent" style={{ width: depth * 20 }} aria-hidden="true" />
          <span className="nv-ptree-toggle" aria-hidden="true" />
          <Icon size={14} className={`nv-ptree-icon is-${adding.type}`} aria-hidden="true" />
          <input
            className="nv-ptree-input"
            autoFocus
            value={adding.name}
            maxLength={60}
            placeholder={`${productNodeTypeLabel(adding.type)}名称`}
            aria-label={`新${productNodeTypeLabel(adding.type)}名称`}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void saveAdd();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(null);
              }
            }}
            onBlur={() => !adding.name.trim() && setAdding(null)}
          />
          <span className="nv-ptree-hint">Enter 保存 · Esc 取消</span>
        </span>
      </div>
    );
  }

  function renderNode(n: ProductTreeNode, depth: number, index: number, siblings: number): React.ReactNode {
    if (visible && !visible.has(n.id)) return null;
    const Icon = TYPE_ICON[n.type as keyof typeof TYPE_ICON] || Box;
    const open = visible ? true : !collapsed.has(n.id);
    const addTypes = PRODUCT_NODE_TYPES.filter((t) => canNest(n.type, t.key));
    const owner = ownerOf(n.ownerId);
    const items: ActionItem[] = [
      ...addTypes.map((t) => ({ label: `添加${t.label}`, onSelect: () => startAdd(n.id, t.key) })),
      { label: "上移", disabled: index === 0, onSelect: () => void call(`/api/products/${productId}/nodes/${n.id}`, "PATCH", { move: "up" }) },
      { label: "下移", disabled: index === siblings - 1, onSelect: () => void call(`/api/products/${productId}/nodes/${n.id}`, "PATCH", { move: "down" }) },
      { label: "删除", tone: "danger", onSelect: () => void remove(n.id) },
    ];
    const isSel = selected === n.id;
    const addType = addTypes.length ? addTypes[addTypes.length - 1] : null;
    return (
      <div key={n.id} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={isSel}>
        <div
          className={`nv-ptree-row${isSel ? " is-selected" : ""}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a, input")) return;
            setSelected(n.id);
          }}
        >
          <span className="nv-ptree-name">
            <span className="nv-ptree-indent" style={{ width: depth * 20 }} aria-hidden="true" />
            {n.children.length ? (
              <button
                type="button"
                className="nv-ptree-toggle"
                aria-expanded={open}
                aria-label={open ? `收起 ${n.name}` : `展开 ${n.name}`}
                onClick={() =>
                  setCollapsed((s) => {
                    const next = new Set(s);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
            ) : (
              <span className="nv-ptree-toggle" aria-hidden="true" />
            )}
            <Icon size={14} className={`nv-ptree-icon is-${n.type}`} aria-hidden="true" />
            <button type="button" className={`nv-ptree-label${depth === 0 ? " is-root" : ""}`} onClick={() => setSelected(n.id)}>
              {n.name}
            </button>
          </span>
          <span className="nv-ptree-type">
            <span className={`nv-tag ${TYPE_TONE[n.type] || "is-neutral"}`}>{TYPE_SHORT[n.type] || productNodeTypeLabel(n.type)}</span>
          </span>
          <span className="nv-ptree-code">{n.code || "—"}</span>
          <span className="nv-ptree-owner">
            {owner ? (
              <>
                <Avatar name={owner.name} src={owner.avatarUrl} size={16} />
                {owner.name}
              </>
            ) : (
              <span className="nv-prod-muted">—</span>
            )}
          </span>
          <span className="nv-ptree-count">{total(n) || "—"}</span>
          <span className="nv-ptree-acts">
            {canManage ? (
              isSel && addType ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`在「${n.name}」下添加${addType.label}`}
                  title={`添加${addType.label}`}
                  onClick={() => startAdd(n.id, addType.key)}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              ) : (
                <ActionMenu label={`「${n.name}」的更多操作`} items={items} />
              )
            ) : null}
          </span>
        </div>
        {open && n.children.length ? <div role="group">{n.children.map((c, i) => renderNode(c, depth + 1, i, n.children.length))}</div> : null}
        {adding && adding.parentId === n.id ? addRow(depth + 1) : null}
      </div>
    );
  }

  // 面板里的关联需求：当前节点和它的全部下级
  const nodeReqs = (() => {
    const t = node ? nodeOf(node.id) : undefined;
    if (!t) return [];
    const out: NodeReq[] = [];
    const walk = (n: ProductTreeNode) => {
      out.push(...(reqsByNode[n.id] || []));
      n.children.forEach(walk);
    };
    walk(t);
    return out;
  })();
  const nodePath = node ? nodeOf(node.id)?.path || [] : [];

  return (
    <div className="nv-pstruct">
      <WorkHeader
        crumbs={[{ label: "功能结构", icon: "layers" }]}
        count={rows.length}
        actions={
          <>
            <label className="nv-head-search is-static nv-ptree-search">
              <Search size={14} aria-hidden="true" />
              <input value={q} placeholder="搜索菜单、模块或功能点" aria-label="搜索菜单、模块或功能点" onChange={(e) => setQ(e.target.value)} />
              {q ? (
                <button type="button" aria-label="清除搜索" onClick={() => setQ("")}>
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <button type="button" className="btn-ghost nv-head-btn" onClick={() => setCollapsed(allOpen ? new Set(allIds) : new Set())}>
              {allOpen ? "全部收起" : "全部展开"}
            </button>
            <ProductEnvButton envs={envs} />
            {canManage ? (
              <>
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => setGenOpen(true)}>
                  <Sparkle size={14} aria-hidden="true" />
                  自动生成
                </button>
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => startAdd(null, "module")}>
                  <Plus size={14} aria-hidden="true" />
                  新增模块
                </button>
                <button type="button" className="btn-primary nv-head-btn" onClick={() => startAdd(null, "menu")}>
                  <Plus size={14} aria-hidden="true" />
                  新增菜单
                </button>
              </>
            ) : null}
          </>
        }
      />
      {genOpen ? (
        <StructureGenModal
          productId={productId}
          productName={productName}
          onClose={() => setGenOpen(false)}
          onDone={(n) => {
            setGenOpen(false);
            toast.success(n ? `已加入 ${n} 个节点` : "没有新增节点（都已存在）");
            router.refresh();
          }}
        />
      ) : null}
      <div className="nv-ptree-legend">
        <span className="nv-ptree-legend-title">层级</span>
        <span>
          <span className="nv-tag is-neutral">菜单</span>可多级，对应系统导航
        </span>
        <span>
          <span className="nv-tag is-info">模块</span>菜单下的功能模块
        </span>
        <span>
          <span className="nv-tag is-neutral">功能点</span>模块内可交付的最小功能
        </span>
      </div>
      <div className="nv-pstruct-body">
        <div className="nv-pstruct-main">
          <div className="nv-ptree-head" aria-hidden="true">
            <span>名称</span>
            <span>类型</span>
            <span>编码</span>
            <span>负责人</span>
            <span>需求</span>
            <span />
          </div>
          {tree.length === 0 && !(adding && !adding.parentId) ? (
            <p className="nv-ptree-empty">
              {canManage ? "还没有功能结构。先点右上角「新增菜单」，再在菜单下添加功能模块和功能点。" : "还没有维护功能结构。"}
            </p>
          ) : null}
          {visible && visible.size === 0 ? <p className="nv-ptree-empty">没有匹配「{q}」的节点。</p> : null}
          <div role="tree" aria-label="功能结构">
            {tree.map((n, i) => renderNode(n, 0, i, tree.length))}
          </div>
          {adding && !adding.parentId ? addRow(0) : null}
        </div>

        <aside className="nv-pstruct-panel" aria-label="节点详情">
          {node && draft ? (
            <>
              <div className="nv-pstruct-panel-head">
                {(() => {
                  const Icon = TYPE_ICON[node.type as keyof typeof TYPE_ICON] || Box;
                  return <Icon size={16} aria-hidden="true" className={`nv-ptree-icon is-${node.type}`} />;
                })()}
                <b>{node.name}</b>
                <span className={`nv-tag ${TYPE_TONE[node.type] || "is-neutral"}`}>{TYPE_SHORT[node.type] || productNodeTypeLabel(node.type)}</span>
                <span className="flex-1" />
                <button type="button" className="icon-button" aria-label="关闭详情" onClick={() => setSelected(null)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="nv-pstruct-path">
                {nodePath.map((seg, i) => (
                  <span key={`${seg}-${i}`} className={i === nodePath.length - 1 ? "is-current" : undefined}>
                    {i ? <i aria-hidden="true">›</i> : null}
                    {seg}
                  </span>
                ))}
              </p>
              <form
                className="nv-pstruct-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveDraft();
                }}
              >
                <div className="nv-pstruct-fields">
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">
                      名称<em aria-hidden="true">*</em>
                    </span>
                    <input className="input" value={draft.name} maxLength={60} disabled={!canManage} onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, name: v } : d)); }} />
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">
                      类型<em aria-hidden="true">*</em>
                    </span>
                    <select className="input" value={draft.type} disabled={!canManage} onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, type: v } : d)); }}>
                      {PRODUCT_NODE_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">
                      上级<em aria-hidden="true">*</em>
                    </span>
                    <select className="input" value={draft.parentId} disabled={!canManage} onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, parentId: v } : d)); }}>
                      {canNest(null, draft.type) ? <option value="">（顶层）</option> : null}
                      {draft.parentId && !parentOptions.some((p) => p.id === draft.parentId) ? (
                        <option value={draft.parentId}>{byId.get(draft.parentId)?.name || "当前上级"}（类型不匹配）</option>
                      ) : null}
                      {parentOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">编码</span>
                    <input
                      className="input"
                      value={draft.code}
                      maxLength={40}
                      placeholder="如 PROJ.REQ"
                      disabled={!canManage}
                      onChange={(e) => { const v = e.target.value.toUpperCase(); setDraft((d) => (d ? { ...d, code: v } : d)); }}
                    />
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">负责人</span>
                    <select className="input" value={draft.ownerId} disabled={!canManage} onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, ownerId: v } : d)); }}>
                      <option value="">未指定</option>
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">描述</span>
                    <textarea
                      className="input nv-pfield-textarea"
                      value={draft.description}
                      maxLength={500}
                      disabled={!canManage}
                      onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, description: v } : d)); }}
                    />
                  </label>
                  <div className="nv-pfield">
                    <span className="nv-pfield-label">
                      关联需求 <span className="nv-pfield-count">{total(nodeOf(node.id)!)}</span>
                    </span>
                    {nodeReqs.length === 0 ? <p className="nv-pfield-empty">还没有需求挂在这里。</p> : null}
                    <ul className="nv-pstruct-reqs">
                      {nodeReqs.slice(0, 3).map((r) => (
                        <li key={r.id}>
                          <span className="nv-pstruct-req-code">{r.code}</span>
                          <Link href={`/requirements/${r.id}`} className="nv-pstruct-req-title" title={r.title}>
                            {r.title}
                          </Link>
                          <ReqStatusBadge status={r.status} />
                        </li>
                      ))}
                    </ul>
                    {total(nodeOf(node.id)!) > 0 ? (
                      <Link href={`/requirements?productNode=${node.id}`} className="nv-pstruct-more">
                        查看全部 {total(nodeOf(node.id)!)} 条 →
                      </Link>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <div className="nv-pstruct-foot">
                    <button type="button" className="btn-ghost nv-head-btn is-danger" onClick={() => void remove(node.id)}>
                      <Trash2 size={14} aria-hidden="true" />
                      删除
                    </button>
                    <span className="flex-1" />
                    <button type="button" className="btn-secondary nv-head-btn" onClick={() => setSelected(null)}>
                      取消
                    </button>
                    <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
                      保存
                    </button>
                  </div>
                ) : null}
              </form>
            </>
          ) : (
            <div className="nv-pstruct-hint">
              <Layers size={20} aria-hidden="true" />
              <p>点击左侧的菜单、功能模块或功能点，在这里查看和编辑详情。</p>
              <p className="nv-prod-muted">需求和 Bug 通过「所属产品 + 功能模块」挂到节点上，节点显示关联需求数（含下级）。</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
