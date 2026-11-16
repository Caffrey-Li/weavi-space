"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronRight, Network, Plus } from "lucide-react";
import { BrandGlyph } from "@/components/ui/BrandLogo";
import { ActionMenu, type ActionItem } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { ORG_TYPE_LABELS, SYSTEM_ORG_ID, flattenOrgs, subtreeIds, type OrgRow } from "@/lib/org-shared";

type Draft = { mode: "create" | "edit"; id?: string; type: "enterprise" | "department"; name: string; parentId: string };

/** 账号增删改后通知侧栏组织树刷新人数 */
export const ORGS_CHANGED_EVENT = "pm-orgs-changed";
export function notifyOrgsChanged() {
  window.dispatchEvent(new Event(ORGS_CHANGED_EVENT));
}

/**
 * 「组织」侧栏里的组织架构树：Weavi Space（系统组织）› 企业 › 部门。
 * 点节点跳到 /members?org=<id>，成员列表按该组织（含下级）筛选；
 * 有账号管理权限时可新建、编辑、删除企业和部门。
 */
export function OrgNav({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const selected = pathname === "/members" ? sp.get("org") || SYSTEM_ORG_ID : "";
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canManage, setCanManage] = useState(false);
  /** 能管理的组织 id；null 表示不限（系统管理员） */
  const [editable, setEditable] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/orgs", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setOrgs(data.orgs || []);
    setCounts(data.counts || {});
    setCanManage(!!data.canManage);
    setEditable(data.editable ?? null);
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener(ORGS_CHANGED_EVENT, load);
    return () => window.removeEventListener(ORGS_CHANGED_EVENT, load);
  }, [load]);

  const memberCount = useCallback(
    (id: string) => subtreeIds(orgs, id).reduce((n, sub) => n + (counts[sub] || 0), 0),
    [orgs, counts],
  );
  function onSelect(id: string) {
    router.push(id === SYSTEM_ORG_ID ? "/members" : `/members?org=${encodeURIComponent(id)}`);
    onNavigate();
  }
  /** 组织有变动：重读树，并让成员页拿到新的组织列表 */
  function changed() {
    void load();
    router.refresh();
  }

  const baseId = useId();
  const confirm = useConfirm();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const flat = useMemo(() => flattenOrgs(orgs), [orgs]);
  const hasChildren = (id: string) => orgs.some((o) => o.parentId === id);
  const hidden = useMemo(() => {
    const out = new Set<string>();
    for (const id of Array.from(collapsed)) for (const sub of subtreeIds(orgs, id)) if (sub !== id) out.add(sub);
    return out;
  }, [collapsed, orgs]);

  /** 部门可选的上级：企业和部门；编辑时排除自己和自己的下级 */
  const parentOptions = useMemo(() => {
    if (!draft) return [];
    if (draft.type === "enterprise") return flat.filter((o) => o.type === "system");
    const exclude = draft.id ? new Set(subtreeIds(orgs, draft.id)) : new Set<string>();
    return flat.filter((o) => o.type !== "system" && !exclude.has(o.id));
  }, [draft, flat, orgs]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(type: Draft["type"], parentId: string) {
    setError("");
    setDraft({ mode: "create", type, name: "", parentId });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    const res = await fetch(draft.mode === "create" ? "/api/orgs" : `/api/orgs/${draft.id}`, {
      method: draft.mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, type: draft.type, parentId: draft.parentId }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "保存失败");
      return;
    }
    const org = data.org as OrgRow;
    if (draft.mode === "create") {
      changed();
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(org.parentId || "");
        return next;
      });
      onSelect(org.id);
      toast.success(`已新建${ORG_TYPE_LABELS[org.type]}「${org.name}」`);
    } else {
      changed();
      toast.success(`已保存「${org.name}」`);
    }
    setDraft(null);
  }

  async function remove(org: OrgRow) {
    if (hasChildren(org.id)) {
      toast.error(`「${org.name}」下还有部门，请先删除或移走下级部门`);
      return;
    }
    const parent = orgs.find((o) => o.id === org.parentId);
    const n = memberCount(org.id);
    const ok = await confirm({
      title: `删除${ORG_TYPE_LABELS[org.type]}「${org.name}」？`,
      body: n
        ? `其中的 ${n} 个账号会移到「${parent?.name ?? "Weavi Space"}」，账号本身不会被删除。`
        : "删除后不能恢复。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/orgs/${org.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }
    if (subtreeIds(orgs, org.id).includes(selected)) onSelect(org.parentId || SYSTEM_ORG_ID);
    changed();
    toast.success(`已删除「${org.name}」`);
  }

  function menuFor(o: OrgRow): ActionItem[] {
    if (o.type === "system") return editable ? [] : [{ label: "新建企业", onSelect: () => openCreate("enterprise", o.id) }];
    const add: ActionItem = { label: "新建下级部门", onSelect: () => openCreate("department", o.id) };
    // 二级组织本身只有系统管理员能改
    if (editable && o.type !== "department") return [add];
    return [
      add,
      {
        label: "编辑",
        onSelect: () => {
          setError("");
          setDraft({ mode: "edit", id: o.id, type: o.type as Draft["type"], name: o.name, parentId: o.parentId || SYSTEM_ORG_ID });
        },
      },
      { label: "删除", tone: "danger", onSelect: () => void remove(o) },
    ];
  }

  const editing = draft?.mode === "edit" ? orgs.find((o) => o.id === draft.id) : null;

  return (
    <div className="nv-nav-group nv-org-panel">
      <div className="nv-nav-group-head">
        <span className="nv-nav-group-label">组织架构</span>
        {canManage && !editable ? (
          <button
            type="button"
            className="icon-button nv-nav-group-act"
            aria-label="新建企业"
            title="新建企业"
            onClick={() => openCreate("enterprise", SYSTEM_ORG_ID)}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </div>
      <ul className="nv-org-tree" role="tree" aria-label="组织架构">
        {flat
          .filter((o) => !hidden.has(o.id))
          .map((o) => {
            const open = !collapsed.has(o.id);
            const kids = hasChildren(o.id);
            return (
              <li
                key={o.id}
                role="treeitem"
                aria-level={o.depth + 1}
                aria-expanded={kids ? open : undefined}
                aria-selected={selected === o.id}
                className="nv-org-node"
                data-selected={selected === o.id || undefined}
                style={{ paddingLeft: 4 + o.depth * 14 }}
              >
                {kids ? (
                  <button
                    type="button"
                    className="nv-org-caret"
                    data-open={open || undefined}
                    aria-label={open ? `收起「${o.name}」` : `展开「${o.name}」`}
                    onClick={() => toggle(o.id)}
                  >
                    <ChevronRight size={12} />
                  </button>
                ) : (
                  <span className="nv-org-caret" aria-hidden="true" />
                )}
                <button type="button" className="nv-org-label" onClick={() => onSelect(o.id)} title={`${o.name} · ${ORG_TYPE_LABELS[o.type]}`}>
                  <span className="nv-org-icon" data-type={o.type} aria-hidden="true">
                    {o.type === "system" ? <BrandGlyph size={12} /> : o.type === "enterprise" ? <Building2 size={14} /> : <Network size={14} />}
                  </span>
                  <span className="nv-org-name">{o.name}</span>
                  {o.type === "system" ? <span className="nv-org-badge">系统</span> : null}
                  <span className="nv-org-count">{memberCount(o.id)}</span>
                </button>
                {canManage && menuFor(o).length ? (
                  <span className="nv-org-more">
                    <ActionMenu label={`${o.name} 的更多操作`} items={menuFor(o)} />
                  </span>
                ) : null}
              </li>
            );
          })}
      </ul>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={
          draft?.mode === "edit"
            ? `编辑${ORG_TYPE_LABELS[draft.type]} · ${editing?.name || ""}`
            : `新建${ORG_TYPE_LABELS[draft?.type || "department"]}`
        }
        dirty={!!draft && (draft.mode === "create" ? !!draft.name : draft.name !== editing?.name || draft.parentId !== editing?.parentId)}
        busy={saving}
      >
        {draft ? (
          <form onSubmit={save} className="space-y-3">
            {error ? (
              <div role="alert" className="banner-error" tabIndex={-1}>{error}</div>
            ) : null}
            <Field id={`${baseId}-name`} label={`${ORG_TYPE_LABELS[draft.type]}名称`} required>
              <input
                className="input"
                required
                maxLength={50}
                autoFocus
                placeholder={draft.type === "enterprise" ? "例如：星河科技" : "例如：产品部"}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field
              id={`${baseId}-parent`}
              label="上级组织"
              hint={draft.type === "enterprise" ? "企业都直属系统组织 Weavi Space" : "可以是企业，也可以是另一个部门"}
            >
              <select
                className="input"
                value={draft.parentId}
                disabled={draft.type === "enterprise"}
                onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
              >
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {"　".repeat(Math.max(0, o.depth - 1))}
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <ModalCancelButton />
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>
                {saving ? "保存中…" : draft.mode === "create" ? "创建" : "保存"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
