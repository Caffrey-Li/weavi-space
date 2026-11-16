"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, ChevronRight, Network, Plus, Search, Trash2, Users, X } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu, type ActionItem } from "@/components/ui/ActionMenu";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { notifyOrgsChanged } from "@/components/members/OrgNav";
import { SYSTEM_ORG_ID, subtreeIds, validParentType, type OrgRow } from "@/lib/org-shared";

export type OrgMember = { id: string; name: string; email: string; avatarUrl?: string | null; role: string; orgId: string };
type TreeNode = OrgRow & { children: TreeNode[]; path: string[] };
type Adding = { parentId: string; type: "enterprise" | "department"; name: string };
type Draft = { name: string; parentId: string };

const TYPE_ICON = { system: Network, enterprise: Building2, department: Users } as const;
const TYPE_SHORT: Record<string, string> = { system: "系统", enterprise: "企业", department: "部门" };
/** 类型标签（Figma 30）：企业用强调色，系统和部门是中性标签 */
const TYPE_TONE: Record<string, string> = { system: "is-neutral", enterprise: "is-info", department: "is-neutral" };
const childTypeOf = (type: string) => (type === "system" ? "enterprise" : "department") as Adding["type"];

/**
 * 组织架构（Figma 30）：功能区（搜索、全部展开、新建部门、新建企业）→ 层级说明 → 树表 + 右侧 340 编辑面板。
 * 系统组织 Weavi Space 唯一、不可修改；企业只能建在它下面；部门建在企业或部门下，可多级。
 * 行内「+」加下级，Enter 保存 / Esc 取消；右侧改名称和上级；删除时组织里的账号移到上级组织。
 */
export function OrgTree({ orgs, members, canManage, isAdmin }: { orgs: OrgRow[]; members: OrgMember[]; canManage: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const byId = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const tree = useMemo(() => {
    const walk = (parentId: string | null, path: string[]): TreeNode[] =>
      orgs
        .filter((o) => o.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((o) => ({ ...o, path: [...path, o.name], children: walk(o.id, [...path, o.name]) }));
    return walk(null, []);
  }, [orgs]);
  const direct = useMemo(() => {
    const m = new Map<string, OrgMember[]>();
    for (const u of members) m.set(u.orgId, [...(m.get(u.orgId) || []), u]);
    return m;
  }, [members]);
  const totalOf = (id: string) => subtreeIds(orgs, id).reduce((n, sub) => n + (direct.get(sub)?.length || 0), 0);
  const nodeOf = (id: string): TreeNode | undefined => {
    let hit: TreeNode | undefined;
    const walk = (l: TreeNode[]) => l.forEach((n) => (n.id === id ? (hit = n) : walk(n.children)));
    walk(tree);
    return hit;
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const node = selected ? byId.get(selected) : undefined;
  useEffect(() => {
    setDraft(node ? { name: node.name, parentId: node.parentId || "" } : null);
  }, [node]);

  // 搜索：命中节点和它的上级都显示
  const visible = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return null;
    const keep = new Set<string>();
    for (const o of orgs) {
      if (o.name.toLowerCase().includes(key)) {
        for (let cur: OrgRow | undefined = o; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) keep.add(cur.id);
      }
    }
    return keep;
  }, [q, orgs, byId]);

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
    notifyOrgsChanged();
    router.refresh();
    return data as Record<string, unknown>;
  }

  function startAdd(parentId: string, type: Adding["type"]) {
    setAdding({ parentId, type, name: "" });
    setCollapsed((s) => {
      const next = new Set(s);
      for (let cur: OrgRow | undefined = byId.get(parentId); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) next.delete(cur.id);
      return next;
    });
  }

  /** 「新建部门」：建在当前选中的企业 / 部门下；没选时用第一个企业 */
  function startAddDepartment() {
    const sel = selected ? byId.get(selected) : undefined;
    const parent = sel && sel.type !== "system" ? sel : orgs.find((o) => o.type === "enterprise");
    if (!parent) return toast.error("先新建企业，再在企业下建部门");
    startAdd(parent.id, "department");
  }

  async function saveAdd() {
    if (!adding || busy) return;
    const name = adding.name.trim();
    if (!name) return setAdding(null);
    const ok = await call("/api/orgs", "POST", { name, type: adding.type, parentId: adding.parentId });
    if (ok) {
      toast.success(`已新建${TYPE_SHORT[adding.type]}「${name}」`);
      setAdding({ ...adding, name: "" }); // 连续录入
    }
  }

  async function saveDraft() {
    if (!node || !draft || busy) return;
    const name = draft.name.trim();
    if (!name) return toast.error("请填写名称");
    const body: Record<string, string> = {};
    if (name !== node.name) body.name = name;
    if (draft.parentId && draft.parentId !== node.parentId) body.parentId = draft.parentId;
    if (!Object.keys(body).length) return toast.success("没有需要保存的修改");
    if (await call(`/api/orgs/${node.id}`, "PATCH", body)) toast.success("已保存");
  }

  async function remove(id: string) {
    const o = byId.get(id);
    if (!o || o.id === SYSTEM_ORG_ID) return;
    if (orgs.some((x) => x.parentId === id)) return toast.error(`「${o.name}」下还有部门，请先删除或移走下级部门`);
    const parentName = (o.parentId && byId.get(o.parentId)?.name) || "Weavi Space";
    const n = direct.get(id)?.length || 0;
    const yes = await confirm({
      title: `删除${TYPE_SHORT[o.type]}「${o.name}」？`,
      body: n ? `这里的 ${n} 个账号会移到上级「${parentName}」。此操作不能撤销。` : "此操作不能撤销。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!yes) return;
    if (await call(`/api/orgs/${id}`, "DELETE")) {
      toast.success(`已删除「${o.name}」`);
      if (selected === id) setSelected(null);
    }
  }

  const allIds = orgs.filter((o) => orgs.some((c) => c.parentId === o.id)).map((o) => o.id);
  const allOpen = collapsed.size === 0;

  /** 部门可选的上级：企业和部门，排除自己和自己的下级 */
  const parentOptions = useMemo(() => {
    if (!node || node.type !== "department") return [];
    const banned = new Set(subtreeIds(orgs, node.id));
    const out: { id: string; label: string }[] = [];
    const walk = (l: TreeNode[]) =>
      l.forEach((n) => {
        if (!banned.has(n.id) && validParentType("department", n.type)) out.push({ id: n.id, label: n.path.join(" › ") });
        walk(n.children);
      });
    walk(tree);
    return out;
  }, [node, orgs, tree]);

  function addRow(depth: number) {
    if (!adding) return null;
    const Icon = TYPE_ICON[adding.type];
    return (
      <div className="nv-ptree-row is-adding">
        <span className="nv-ptree-name">
          <span className="nv-ptree-indent" style={{ width: depth * 20 }} aria-hidden="true" />
          <span className="nv-ptree-toggle" aria-hidden="true" />
          <Icon size={14} className="nv-ptree-icon nv-org-icon" aria-hidden="true" />
          <input
            className="nv-ptree-input"
            autoFocus
            value={adding.name}
            maxLength={50}
            placeholder={`${TYPE_SHORT[adding.type]}名称`}
            aria-label={`新${TYPE_SHORT[adding.type]}名称`}
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

  function renderNode(n: TreeNode, depth: number): React.ReactNode {
    if (visible && !visible.has(n.id)) return null;
    const Icon = TYPE_ICON[n.type as keyof typeof TYPE_ICON] || Users;
    const open = visible ? true : !collapsed.has(n.id);
    const isSel = selected === n.id;
    const childType = childTypeOf(n.type);
    const parentName = n.parentId ? byId.get(n.parentId)?.name || "—" : "—";
    const directCount = direct.get(n.id)?.length || 0;
    const items: ActionItem[] = [
      { label: `新建下级${TYPE_SHORT[childType]}`, icon: Plus, onSelect: () => startAdd(n.id, childType) },
      { label: "查看成员", icon: Users, onSelect: () => router.push(n.id === SYSTEM_ORG_ID ? "/members" : `/members?org=${encodeURIComponent(n.id)}`) },
      ...(n.id === SYSTEM_ORG_ID ? [] : [{ label: "删除", icon: Trash2, tone: "danger" as const, divider: true, onSelect: () => void remove(n.id) }]),
    ];
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
            <Icon size={14} className="nv-ptree-icon nv-org-icon" aria-hidden="true" />
            <button type="button" className={`nv-ptree-label${depth === 0 ? " is-root" : ""}`} onClick={() => setSelected(n.id)}>
              {n.name}
            </button>
          </span>
          <span className="nv-ptree-type">
            <span className={`nv-tag ${TYPE_TONE[n.type] || "is-neutral"}`}>{TYPE_SHORT[n.type] || n.type}</span>
          </span>
          <span className="nv-ptree-code">{parentName}</span>
          <span className="nv-ptree-owner">{directCount ? `${directCount} 人` : <span className="nv-prod-muted">—</span>}</span>
          <span className="nv-ptree-count">{totalOf(n.id)}</span>
          <span className="nv-ptree-acts">
            {canManage && (isAdmin || n.id !== SYSTEM_ORG_ID) ? (
              isSel ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`在「${n.name}」下新建${TYPE_SHORT[childType]}`}
                  title={`新建下级${TYPE_SHORT[childType]}`}
                  onClick={() => startAdd(n.id, childType)}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              ) : (
                <ActionMenu label={`「${n.name}」的更多操作`} items={items} />
              )
            ) : null}
          </span>
        </div>
        {open && n.children.length ? <div role="group">{n.children.map((c) => renderNode(c, depth + 1))}</div> : null}
        {adding && adding.parentId === n.id ? addRow(depth + 1) : null}
      </div>
    );
  }

  const nodePath = node ? nodeOf(node.id)?.path || [] : [];
  const nodeDirect = node ? direct.get(node.id) || [] : [];
  const nodeTotal = node ? totalOf(node.id) : 0;
  const isSystem = node?.id === SYSTEM_ORG_ID;
  // 二级组织本身和系统组织只有系统管理员能改
  const editable = canManage && !isSystem && (isAdmin || node?.type === "department");
  const membersHref = node ? (isSystem ? "/members" : `/members?org=${encodeURIComponent(node.id)}`) : "/members";

  return (
    <div className="nv-pstruct">
      <WorkHeader
        crumbs={[{ label: "组织架构", icon: "network" }]}
        count={orgs.length}
        actions={
          <>
            <label className="nv-head-search is-static nv-ptree-search">
              <Search size={14} aria-hidden="true" />
              <input value={q} placeholder="搜索企业或部门" aria-label="搜索企业或部门" onChange={(e) => setQ(e.target.value)} />
              {q ? (
                <button type="button" aria-label="清除搜索" onClick={() => setQ("")}>
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <button type="button" className="btn-ghost nv-head-btn" onClick={() => setCollapsed(allOpen ? new Set(allIds) : new Set())}>
              {allOpen ? "全部收起" : "全部展开"}
            </button>
            {canManage ? (
              <>
                <button type="button" className="btn-secondary nv-head-btn" onClick={startAddDepartment}>
                  <Plus size={14} aria-hidden="true" />
                  新建部门
                </button>
                {isAdmin ? <button type="button" className="btn-primary nv-head-btn" onClick={() => startAdd(SYSTEM_ORG_ID, "enterprise")}>
                  <Plus size={14} aria-hidden="true" />
                  新建企业
                </button> : null}
              </>
            ) : null}
          </>
        }
      />
      <div className="nv-ptree-legend">
        <span className="nv-ptree-legend-title">层级</span>
        <span>
          <span className="nv-tag is-neutral">系统</span>Weavi Space，唯一，不可修改
        </span>
        <span>
          <span className="nv-tag is-info">企业</span>建在 Weavi Space 下
        </span>
        <span>
          <span className="nv-tag is-neutral">部门</span>建在企业或部门下，可多级
        </span>
      </div>
      <div className="nv-pstruct-body">
        <div className="nv-pstruct-main">
          <div className="nv-ptree-head" aria-hidden="true">
            <span>名称</span>
            <span>类型</span>
            <span>上级</span>
            <span>直属成员</span>
            <span>含下级</span>
            <span />
          </div>
          {visible && visible.size === 0 ? <p className="nv-ptree-empty">没有匹配「{q}」的企业或部门。</p> : null}
          <div role="tree" aria-label="组织架构">
            {tree.map((n) => renderNode(n, 0))}
          </div>
          {orgs.length <= 1 && isAdmin && !adding ? (
            <p className="nv-ptree-empty">还没有企业。点右上角「新建企业」，再在企业下建部门。</p>
          ) : null}
        </div>

        <aside className="nv-pstruct-panel" aria-label="组织详情">
          {node && draft ? (
            <>
              <div className="nv-pstruct-panel-head">
                {(() => {
                  const Icon = TYPE_ICON[node.type as keyof typeof TYPE_ICON] || Users;
                  return <Icon size={16} aria-hidden="true" className="nv-ptree-icon nv-org-icon" />;
                })()}
                <b>{node.name}</b>
                <span className={`nv-tag ${TYPE_TONE[node.type] || "is-neutral"}`}>{TYPE_SHORT[node.type]}</span>
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
                    <input className="input" value={draft.name} maxLength={50} disabled={!editable} onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, name: v } : d)); }} />
                  </label>
                  <label className="nv-pfield">
                    <span className="nv-pfield-label">
                      类型<em aria-hidden="true">*</em>
                    </span>
                    <select className="input" value={node.type} disabled aria-describedby="org-type-hint">
                      <option value="system">系统组织</option>
                      <option value="enterprise">企业</option>
                      <option value="department">部门</option>
                    </select>
                    <span id="org-type-hint" className="nv-pfield-hint">
                      {isSystem
                        ? "系统组织唯一，不能修改或删除；没有所属组织的账号都算在这里"
                        : node.type === "enterprise"
                          ? "类型创建后不可修改；企业固定建在 Weavi Space 下"
                          : "类型创建后不可修改；部门可以移到其他企业或部门下"}
                    </span>
                  </label>
                  {!isSystem ? (
                    <label className="nv-pfield">
                      <span className="nv-pfield-label">
                        上级<em aria-hidden="true">*</em>
                      </span>
                      <select
                        className="input"
                        value={draft.parentId}
                        disabled={!editable || node.type === "enterprise"}
                        onChange={(e) => { const v = e.target.value; setDraft((d) => (d ? { ...d, parentId: v } : d)); }}
                      >
                        {node.type === "enterprise" ? (
                          <option value={SYSTEM_ORG_ID}>Weavi Space</option>
                        ) : (
                          parentOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  ) : null}
                  <div className="nv-pfield">
                    <span className="nv-pfield-label">
                      直属成员 <span className="nv-pfield-count">{nodeDirect.length} · 含下级 {nodeTotal}</span>
                    </span>
                    {nodeDirect.length === 0 ? <p className="nv-pfield-empty">没有直属成员。在「成员管理」里编辑账号可以调整所属组织。</p> : null}
                    <ul className="nv-pstruct-reqs">
                      {nodeDirect.slice(0, 3).map((u) => (
                        <li key={u.id}>
                          <span className="nv-pstruct-req-title nv-org-member">{u.name}</span>
                          <span className="nv-pstruct-req-code nv-org-member-meta">
                            {u.email} · {u.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {nodeTotal > 0 ? (
                      <Link href={membersHref} className="nv-pstruct-more">
                        在成员管理中查看这 {nodeTotal} 人 →
                      </Link>
                    ) : null}
                  </div>
                </div>
                {editable ? (
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
              <Network size={20} aria-hidden="true" />
              <p>点击左侧的企业或部门，在这里改名称、调整上级、查看成员。</p>
              <p className="nv-prod-muted">账号属于哪个企业 / 部门，在「成员管理」里编辑账号时选择；没有所属组织的账号算在 Weavi Space 下。</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
