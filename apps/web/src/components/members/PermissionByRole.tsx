"use client";

import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { ChevronDown, ChevronRight, Info, Lock, RotateCcw } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";

type Feature = { key: string; label: string };
type PermRow = { role: string; feature: string; allowed: boolean };

/** 功能点分组（方案 A：按角色集中配置） */
const GROUPS: { label: string; keys: string[] }[] = [
  { label: "管理", keys: ["users.manage", "project.edit", "members.manage"] },
  { label: "需求与协作", keys: ["requirements.create", "requirements.edit", "board.move", "docs.edit", "products.manage"] },
  { label: "交付与进展", keys: ["releases.manage", "bugs.edit", "bugs.delete", "leadership.view"] },
];

const FEATURE_HINT: Record<string, string> = {
  "users.manage": "新建账号、改岗位、停用与重置密码，也包括本页的权限配置",
  "project.edit": "新建项目、编辑项目信息与项目资料",
  "members.manage": "按岗位把人加入或移出项目",
  "requirements.create": "在需求池新建需求、同步飞书排期表",
  "requirements.edit": "编辑需求内容、归属项目与负责人",
  "board.move": "在看板、需求池中改需求状态",
  "releases.manage": "新建发版、选需求、冻结与上线",
  "bugs.edit": "提交、编辑 Bug 并改状态",
  "bugs.delete": "把 Bug 移入回收站（含批量删除）和从回收站恢复",
  "leadership.view": "查看进展总览",
  "docs.edit": "在项目空间新建、编辑、发布文档页面",
  "products.manage": "新建产品，维护产品的菜单层级和功能模块",
};

const key = (role: string, feature: string) => `${role}::${feature}`;

/** 角色色点（与岗位标签同色） */
const ROLE_DOT: Record<string, string> = {
  admin: "var(--nv-role-admin)",
  director: "var(--nv-role-director)",
  pm: "var(--nv-role-pm)",
  tech_lead: "var(--nv-role-tech-lead)",
  product: "var(--nv-role-product)",
  frontend: "var(--nv-role-frontend)",
  backend: "var(--nv-role-backend)",
  qa: "var(--nv-role-qa)",
  member: "var(--nv-role-member)",
};

/** 分组复选框：全开 / 全关 / 部分（indeterminate） */
function GroupCheck({ state, disabled, label, onChange }: { state: "on" | "off" | "mixed"; disabled: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="nv-ptree-check"
      checked={state === "on"}
      ref={(el) => {
        if (el) el.indeterminate = state === "mixed";
      }}
      aria-checked={state === "mixed" ? "mixed" : state === "on"}
      aria-label={label}
      disabled={disabled}
      onChange={() => onChange(state !== "on")}
    />
  );
}

/**
 * 角色权限（Figma 17）：左侧角色列表，右侧当前角色的分组权限树。
 * 分组可折叠；分组复选框一键全开 / 全关，部分开通时显示半选。
 * 修改先暂存，点「保存更改」逐项提交；失败的项回到原值并提示。管理员权限固定。
 */
export function PermissionByRole({
  features,
  roles,
  initial,
  defaults: defaultRows,
  canEdit,
}: {
  features: Feature[];
  roles: string[];
  initial: PermRow[];
  /** 系统默认权限（「恢复默认」用） */
  defaults: PermRow[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const base = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of initial) m[key(r.role, r.feature)] = r.allowed;
    return m;
  }, [initial]);
  const defaults = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of defaultRows) if (r.role !== "admin") m[key(r.role, r.feature)] = r.allowed;
    return m;
  }, [defaultRows]);
  const [saved, setSaved] = useState(base);
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changes = useMemo(
    () => Object.keys(draft).filter((k) => draft[k] !== saved[k]),
    [draft, saved],
  );

  useEffect(() => {
    if (!changes.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

  const featureLabel = (k: string) => features.find((f) => f.key === k)?.label || k;

  async function save() {
    if (!changes.length || saving) return;
    setSaving(true);
    setError("");
    const failed: string[] = [];
    const next = { ...saved };
    for (const k of changes) {
      const [r, f] = k.split("::");
      try {
        const res = await fetch("/api/permissions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "project", role: r, feature: f, allowed: draft[k] }),
        });
        if (res.ok) next[k] = draft[k];
        else failed.push(`${ROLE_LABELS[r] || r} · ${featureLabel(f)}`);
      } catch {
        failed.push(`${ROLE_LABELS[r] || r} · ${featureLabel(f)}`);
      }
    }
    setSaved(next);
    setDraft((d) => {
      const out = { ...d };
      for (const k of changes) if (next[k] !== d[k]) out[k] = next[k];
      return out;
    });
    setSaving(false);
    if (failed.length) setError(`以下 ${failed.length} 项未保存，已恢复原值：${failed.join("、")}`);
    else toast.success(`已保存 ${changes.length} 项权限更改`);
  }

  const cols = roles.filter((r) => r !== "admin");
  const resetDefaults = () => setDraft((d) => ({ ...d, ...defaults }));
  const diffFromDefault = Object.keys(defaults).some((k) => draft[k] !== defaults[k]);
  const [role, setRole] = useState<string>(cols.includes("pm") ? "pm" : cols[0] || "admin");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const isAdmin = role === "admin";
  const editable = canEdit && !saving && !isAdmin;
  const on = (r: string, f: string) => (r === "admin" ? true : !!draft[key(r, f)]);
  const groups = GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => features.some((f) => f.key === k)) }));
  const total = groups.reduce((n, g) => n + g.keys.length, 0);
  const countOn = (r: string) => groups.reduce((n, g) => n + g.keys.filter((k) => on(r, k)).length, 0);
  const changedFor = (r: string) => changes.filter((k) => k.startsWith(`${r}::`)).length;
  const setGroup = (keys: string[], value: boolean) => setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [key(role, k), value])) }));

  return (
    <div className="nv-page-flush">
      <WorkHeader
        crumbs={[{ label: "角色权限", icon: "shield" }]}
        actions={
          canEdit ? (
            <>
              {changes.length ? <span className="perm-dirty">有 {changes.length} 项未保存</span> : null}
              <button type="button" className="btn-secondary nv-head-btn" disabled={saving || !diffFromDefault} onClick={resetDefaults} title="把所有角色恢复为系统默认权限（保存后生效）">
                <RotateCcw size={14} aria-hidden="true" />
                恢复默认
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={!changes.length || saving} aria-busy={saving || undefined} onClick={() => void save()}>
                {saving ? "保存中…" : "保存"}
              </button>
            </>
          ) : null
        }
      />
      <div className="nv-page-body nv-perm">
        <div className="info-banner tone-info" role="note">
          <Info size={18} aria-hidden="true" className="info-banner-icon" />
          <div className="min-w-0 flex-1">
            <p className="info-banner-title">权限按「项目内角色」生效</p>
            <div className="info-banner-body">
              系统管理员始终拥有全部权限；成员在项目中的角色优先于全局角色。页面仅控制入口显示，接口仍会逐一校验。
              {canEdit ? null : " 当前为只读视图，仅有「账号管理」权限的角色可修改。"}
            </div>
          </div>
        </div>
        {error ? (
          <div role="alert" className="banner-error">
            {error}
          </div>
        ) : null}
        <div className="nv-perm2">
          <nav className="nv-perm2-roles" aria-label="角色">
            <p className="nv-perm2-roles-title">
              角色 <span>{roles.length}</span>
            </p>
            {roles.map((r) => {
              const n = changedFor(r);
              return (
                <button
                  key={r}
                  type="button"
                  className={`nv-perm2-role${role === r ? " is-active" : ""}`}
                  aria-current={role === r ? "true" : undefined}
                  onClick={() => setRole(r)}
                >
                  <i style={{ background: ROLE_DOT[r] || "var(--nv-role-member)" }} aria-hidden="true" />
                  <span className="nv-perm2-role-text">
                    <b>{ROLE_LABELS[r] || r}</b>
                    <code>{r}</code>
                  </span>
                  {r === "admin" ? <Lock size={14} aria-hidden="true" /> : null}
                  <span className="nv-perm2-role-count">
                    {n ? <em title={`${n} 项未保存`} /> : null}
                    {r === "admin" ? "全部" : `${countOn(r)} / ${total}`}
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="nv-perm2-tree" aria-label={`${ROLE_LABELS[role] || role}的权限`}>
            <header className="nv-perm2-head">
              <i style={{ background: ROLE_DOT[role] || "var(--nv-role-member)" }} aria-hidden="true" />
              <h2>{ROLE_LABELS[role] || role}</h2>
              <code>{role}</code>
              <span className="flex-1" />
              <span className="nv-perm2-sum">{isAdmin ? "系统管理员固定拥有全部权限，不可修改" : `已开通 ${countOn(role)} / ${total} 项`}</span>
            </header>
            <div role="tree" aria-label="权限树">
              {groups.map((g) => {
                const n = g.keys.filter((k) => on(role, k)).length;
                const state = n === 0 ? "off" : n === g.keys.length ? "on" : "mixed";
                const open = !folded.has(g.label);
                return (
                  <div key={g.label} role="treeitem" aria-expanded={open} aria-selected={false}>
                    <div className="nv-perm2-group">
                      <button
                        type="button"
                        className="nv-ptree-toggle"
                        aria-label={open ? `收起 ${g.label}` : `展开 ${g.label}`}
                        onClick={() =>
                          setFolded((s) => {
                            const next = new Set(s);
                            if (next.has(g.label)) next.delete(g.label);
                            else next.add(g.label);
                            return next;
                          })
                        }
                      >
                        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      </button>
                      <GroupCheck state={state} disabled={!editable} label={`${g.label}：全部开通或关闭`} onChange={(v) => setGroup(g.keys, v)} />
                      <b>{g.label}</b>
                      <span className="flex-1" />
                      <span className="nv-perm2-count">
                        {n} / {g.keys.length}
                      </span>
                    </div>
                    {open ? (
                      <div role="group">
                        {g.keys.map((f) => {
                          const k = key(role, f);
                          const changed = !isAdmin && draft[k] !== saved[k];
                          return (
                            <label key={f} role="treeitem" aria-selected={false} className={`nv-perm2-item${changed ? " is-changed" : ""}`}>
                              <input
                                type="checkbox"
                                className="nv-ptree-check"
                                checked={on(role, f)}
                                disabled={!editable}
                                onChange={() => setDraft((d) => ({ ...d, [k]: !d[k] }))}
                              />
                              <span className="nv-perm2-item-text">
                                <span className="nv-perm2-item-name">
                                  {featureLabel(f)}
                                  <code>{f}</code>
                                  {changed ? <em>未保存</em> : null}
                                </span>
                                <small>{FEATURE_HINT[f]}</small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
