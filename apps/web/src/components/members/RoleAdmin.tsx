"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Info, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { DATA_SCOPES, dataScopeLabel, defaultRoleAllow } from "@/lib/roles-shared";

type Feature = { key: string; label: string };
export type RoleAdminRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  dataScope: string;
  isSystem: boolean;
  userCount: number;
  permissions: Record<string, boolean>;
  /** T37：企业角色所属企业（系统角色为空） */
  enterpriseId?: string;
  enterpriseName?: string | null;
  /** T37：当前用户能不能改这个角色 */
  editable?: boolean;
  /** T37：企业角色能开的功能上限；系统角色为 null */
  ceiling?: string[] | null;
};
type Opt = { id: string; name: string };

/** 功能点分组 */
const GROUPS: { label: string; keys: string[] }[] = [
  { label: "管理", keys: ["users.manage", "project.edit", "members.manage"] },
  { label: "需求与协作", keys: ["requirements.create", "requirements.edit", "board.move", "docs.edit", "products.manage"] },
  { label: "交付与进展", keys: ["releases.manage", "bugs.edit", "bugs.delete", "leadership.view"] },
];

const FEATURE_HINT: Record<string, string> = {
  "users.manage": "新建账号、调整角色和岗位、停用与重置密码，也包括本页、岗位和组织架构的配置",
  "project.edit": "新建项目、编辑项目信息与项目资料",
  "members.manage": "把人加入或移出项目，调整项目内岗位",
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

/** 角色色点：内置角色固定色，自定义角色统一紫色 */
const ROLE_DOT: Record<string, string> = {
  admin: "var(--nv-role-admin)",
  manager: "var(--nv-role-director)",
  member: "var(--nv-role-pm)",
  guest: "var(--nv-role-tech-lead)",
};
const dotOf = (key: string) => ROLE_DOT[key] || "var(--nv-role-product)";

type Draft = { dataScope: string; permissions: Record<string, boolean> };

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
 * 角色权限（Figma 17 / 34）：左侧角色列表（内置 + 自定义，可新建），
 * 右侧当前角色的「数据权限」（四档范围）和「功能权限」分组树。
 * 修改先暂存，点「保存」逐个角色提交。系统管理员固定全部权限。
 */
export function RoleAdmin({ roles: initial, features, canEdit, createIn = [], enterprises = [], isSystemAdmin = false }: { roles: RoleAdminRow[]; features: Feature[]; canEdit: boolean; createIn?: Opt[]; enterprises?: Opt[]; isSystemAdmin?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [roles, setRoles] = useState(initial);
  useEffect(() => setRoles(initial), [initial]);
  const savedOf = useMemo(() => Object.fromEntries(roles.map((r) => [r.key, { dataScope: r.dataScope, permissions: r.permissions } as Draft])), [roles]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(savedOf);
  useEffect(() => setDrafts(savedOf), [savedOf]);
  const [roleKey, setRoleKey] = useState<string>(() => (initial.some((r) => r.key === "member") ? "member" : initial[0]?.key || "admin"));
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // 新建 / 改名弹窗
  const [form, setForm] = useState<null | { mode: "create" | "rename"; name: string; description: string; copyFrom: string; enterpriseId: string }>(null);
  // T37 企业权限上限（系统超管）
  const [ceilingOpen, setCeilingOpen] = useState(false);
  const [ceilingEnt, setCeilingEnt] = useState("");
  const [ceilingSet, setCeilingSet] = useState<string[]>([]);
  const [ceilingBusy, setCeilingBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const role = roles.find((r) => r.key === roleKey) || roles[0];
  const draft = role ? drafts[role.key] : undefined;
  const isAdmin = role?.key === "admin";
  const roleEditable = canEdit && role?.editable !== false;
  const editable = roleEditable && !saving && !isAdmin;
  const capped = (f: string) => Boolean(role?.ceiling && !role.ceiling.includes(f));

  const changedKeys = (k: string) => {
    const d = drafts[k];
    const s = savedOf[k];
    if (!d || !s) return [] as string[];
    const out = features.filter((f) => d.permissions[f.key] !== s.permissions[f.key]).map((f) => f.key);
    if (d.dataScope !== s.dataScope) out.push("dataScope");
    return out;
  };
  const dirtyRoles = roles.filter((r) => changedKeys(r.key).length);
  const dirtyCount = dirtyRoles.reduce((n, r) => n + changedKeys(r.key).length, 0);

  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const groups = GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => features.some((f) => f.key === k)) }));
  const total = groups.reduce((n, g) => n + g.keys.length, 0);
  const on = (k: string, f: string) => (k === "admin" ? true : Boolean(drafts[k]?.permissions[f]));
  const countOn = (k: string) => groups.reduce((n, g) => n + g.keys.filter((f) => on(k, f)).length, 0);
  const featureLabel = (k: string) => features.find((f) => f.key === k)?.label || k;
  const setPerm = (keys: string[], value: boolean) =>
    setDrafts((d) => ({ ...d, [role.key]: { ...d[role.key], permissions: { ...d[role.key].permissions, ...Object.fromEntries(keys.map((k) => [k, value])) } } }));

  // 恢复默认：内置角色回到系统默认，自定义角色回到「成员」默认
  const defaults: Draft | null = role && !isAdmin
    ? {
        dataScope: role.key === "manager" ? "enterprise" : "involved",
        permissions: Object.fromEntries(features.map((f) => [f.key, defaultRoleAllow(role.isSystem ? role.key : "member", f.key)])),
      }
    : null;
  const diffFromDefault = Boolean(
    defaults && draft && (draft.dataScope !== defaults.dataScope || features.some((f) => draft.permissions[f.key] !== defaults.permissions[f.key])),
  );

  async function save() {
    if (!dirtyRoles.length || saving) return;
    setSaving(true);
    setError("");
    const failed: string[] = [];
    for (const r of dirtyRoles) {
      const keys = changedKeys(r.key);
      const d = drafts[r.key];
      const body: Record<string, unknown> = { id: r.id };
      if (keys.includes("dataScope")) body.dataScope = d.dataScope;
      const perms = Object.fromEntries(keys.filter((k) => k !== "dataScope").map((k) => [k, d.permissions[k]]));
      if (Object.keys(perms).length) body.permissions = perms;
      try {
        const res = await fetch("/api/roles", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) failed.push(r.name);
      } catch {
        failed.push(r.name);
      }
    }
    // 成功的落为已保存；失败的回到原值
    setRoles((prev) =>
      prev.map((r) => (dirtyRoles.some((x) => x.key === r.key) && !failed.includes(r.name) ? { ...r, dataScope: drafts[r.key].dataScope, permissions: drafts[r.key].permissions } : r)),
    );
    setSaving(false);
    if (failed.length) setError(`以下角色未保存，已恢复原值：${failed.join("、")}`);
    else toast.success(`已保存 ${dirtyCount} 项更改`);
    router.refresh();
  }

  function openCreate() {
    setFormError("");
    setForm({ mode: "create", name: "", description: "", copyFrom: "member", enterpriseId: createIn[createIn.length > 1 ? 0 : 0]?.id ?? "" });
  }
  function openRename() {
    if (!role) return;
    setFormError("");
    setForm({ mode: "rename", name: role.name, description: role.description || "", copyFrom: "", enterpriseId: role.enterpriseId || "" });
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form || formBusy) return;
    if (!form.name.trim()) {
      setFormError("请填写角色名称");
      return;
    }
    setFormBusy(true);
    setFormError("");
    const res = await fetch("/api/roles", {
      method: form.mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        form.mode === "create"
          ? { name: form.name, description: form.description, copyFrom: form.copyFrom, enterpriseId: form.enterpriseId }
          : { id: role.id, name: form.name, description: form.description },
      ),
    });
    const data = await res.json().catch(() => ({}));
    setFormBusy(false);
    if (!res.ok) {
      setFormError(data.error || "保存失败");
      return;
    }
    if (form.mode === "create" && data.role?.key) {
      setRoleKey(data.role.key);
      toast.success(`已新建角色「${form.name.trim()}」`);
    } else {
      setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, name: form.name.trim(), description: form.description.trim() || null } : r)));
      toast.success("已更新角色名称");
    }
    setForm(null);
    router.refresh();
  }

  async function remove() {
    if (!role || role.isSystem) return;
    const ok = await confirm({
      title: `删除角色「${role.name}」？`,
      body: role.userCount ? `还有 ${role.userCount} 人使用这个角色，需要先在成员管理里把他们调整到别的角色。` : "删除后不能恢复。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/roles?id=${encodeURIComponent(role.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }
    toast.success(`已删除角色「${role.name}」`);
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
    setRoleKey("member");
    router.refresh();
  }

  async function openCeiling(ent: string) {
    setCeilingEnt(ent);
    setCeilingOpen(true);
    const r = await fetch(`/api/roles/ceiling?enterpriseId=${encodeURIComponent(ent)}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setCeilingSet(d.features || []);
    else toast.error(d.error || "读取失败");
  }
  async function saveCeiling() {
    setCeilingBusy(true);
    const r = await fetch("/api/roles/ceiling", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enterpriseId: ceilingEnt, features: ceilingSet }) });
    const d = await r.json().catch(() => ({}));
    setCeilingBusy(false);
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success("已保存，企业角色立即按新上限生效");
    setCeilingOpen(false);
    router.refresh();
  }

  if (!role || !draft) return null;
  const copySource = roles.find((r) => r.key === form?.copyFrom);

  return (
    <div className="nv-page-flush">
      <WorkHeader
        crumbs={[{ label: "角色权限", icon: "shield" }]}
        actions={
          canEdit ? (
            <>
              {isSystemAdmin && enterprises.length ? (
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => void openCeiling(enterprises[0].id)} title="企业自建角色最多能开哪些功能">
                  企业权限上限
                </button>
              ) : null}
              {dirtyCount ? <span className="perm-dirty">有 {dirtyCount} 项未保存</span> : null}
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                disabled={saving || !diffFromDefault || !defaults || !roleEditable}
                onClick={() => defaults && setDrafts((d) => ({ ...d, [role.key]: defaults }))}
                title="把当前角色的数据权限和功能权限恢复为默认值（保存后生效）"
              >
                <RotateCcw size={14} aria-hidden="true" />
                恢复默认
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={!dirtyCount || saving} aria-busy={saving || undefined} onClick={() => void save()}>
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
            <p className="info-banner-title">角色决定「能做什么」和「能看到哪些数据」</p>
            <div className="info-banner-body">
              岗位（产品经理、前端…）只表示人在项目中的职责，不影响权限，在「岗位管理」中维护。系统管理员始终拥有全部权限；页面仅控制入口显示，接口仍会逐一校验。
              {canEdit ? (isSystemAdmin ? " 企业超管可以在这里新建本企业的角色，权限不超过你给企业定的上限。" : " 你可以新建和修改本企业的角色（标「本企业」），系统角色只读；能开的功能不超过系统超管给企业定的上限。") : " 当前为只读视图，只有系统超管和企业超管可以修改。"}
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
              const n = changedKeys(r.key).length;
              return (
                <button
                  key={r.key}
                  type="button"
                  className={`nv-perm2-role${role.key === r.key ? " is-active" : ""}`}
                  aria-current={role.key === r.key ? "true" : undefined}
                  onClick={() => setRoleKey(r.key)}
                >
                  <i style={{ background: dotOf(r.key) }} aria-hidden="true" />
                  <span className="nv-perm2-role-text">
                    <b>
                      {r.name}
                      {r.enterpriseName ? <span className="nv-tag is-neutral nv-perm2-ent">{isSystemAdmin ? r.enterpriseName : "本企业"}</span> : null}
                    </b>
                    <small>
                      {dataScopeLabel(drafts[r.key]?.dataScope || r.dataScope)} · {r.userCount} 人
                    </small>
                  </span>
                  {r.key === "admin" ? <Lock size={14} aria-hidden="true" /> : null}
                  <span className="nv-perm2-role-count">
                    {n ? <em title={`${n} 项未保存`} /> : null}
                    {r.key === "admin" ? "全部" : `${countOn(r.key)} / ${total}`}
                  </span>
                </button>
              );
            })}
            {canEdit ? (
              <button type="button" className="btn-ghost nv-head-btn nv-perm2-new" onClick={openCreate}>
                <Plus size={14} aria-hidden="true" />
                新建角色
              </button>
            ) : null}
          </nav>

          <section className="nv-perm2-tree" aria-label={`${role.name}的权限`}>
            <header className="nv-perm2-head">
              <i style={{ background: dotOf(role.key) }} aria-hidden="true" />
              <h2>{role.name}</h2>
              <code>{role.key}</code>
              <span className="flex-1" />
              <span className="nv-perm2-sum">
                {role.isSystem ? "内置角色" : role.enterpriseName ? "企业角色" : "自定义角色"} · {role.userCount} 人
              </span>
              {roleEditable && !isAdmin ? (
                <>
                  <button type="button" className="btn-ghost nv-head-btn" onClick={openRename}>
                    <Pencil size={14} aria-hidden="true" />
                    编辑名称
                  </button>
                  <button
                    type="button"
                    className="btn-ghost nv-head-btn"
                    disabled={role.isSystem}
                    title={role.isSystem ? "内置角色不能删除" : undefined}
                    onClick={() => void remove()}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    删除
                  </button>
                </>
              ) : null}
            </header>

            <div className="nv-perm2-scope">
              <p className="nv-perm2-sec">
                <b>数据权限</b>
                <span>决定这个角色能看到哪些项目、产品、需求和 Bug</span>
              </p>
              <div className="nv-perm2-scopes" role="radiogroup" aria-label="数据权限">
                {DATA_SCOPES.filter((s) => (s.key === "all") === isAdmin).map((s) => {
                  const checked = (isAdmin ? "all" : draft.dataScope) === s.key;
                  const changed = !isAdmin && draft.dataScope !== savedOf[role.key]?.dataScope && checked;
                  return (
                    <label key={s.key} className={`nv-pform-card${checked ? " is-on" : ""}${!editable ? " is-readonly" : ""}`}>
                      <input
                        type="radio"
                        name={`${baseId}-scope`}
                        checked={checked}
                        disabled={!editable}
                        onChange={() => setDrafts((d) => ({ ...d, [role.key]: { ...d[role.key], dataScope: s.key } }))}
                      />
                      <span>
                        <b>
                          {s.label}
                          {changed ? <em className="nv-perm2-unsaved">未保存</em> : null}
                        </b>
                        <small>{s.hint}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <p className="nv-perm2-sec is-func">
              <b>功能权限</b>
              <span>决定这个角色能使用哪些功能</span>
              <span className="flex-1" />
              <span className="nv-perm2-sum">{isAdmin ? "系统管理员固定拥有全部权限，不可修改" : `已开通 ${countOn(role.key)} / ${total} 项${role.ceiling ? ` · 企业上限 ${role.ceiling.length} 项` : ""}`}</span>
            </p>
            <div role="tree" aria-label="功能权限">
              {groups.map((g) => {
                const n = g.keys.filter((k) => on(role.key, k)).length;
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
                      <GroupCheck state={state} disabled={!editable} label={`${g.label}：全部开通或关闭`} onChange={(v) => setPerm(v ? g.keys.filter((k) => !capped(k)) : g.keys, v)} />
                      <b>{g.label}</b>
                      <span className="flex-1" />
                      <span className="nv-perm2-count">
                        {n} / {g.keys.length}
                      </span>
                    </div>
                    {open ? (
                      <div role="group">
                        {g.keys.map((f) => {
                          const changed = !isAdmin && draft.permissions[f] !== savedOf[role.key]?.permissions[f];
                          return (
                            <label key={f} role="treeitem" aria-selected={false} className={`nv-perm2-item${changed ? " is-changed" : ""}`}>
                              <input
                                type="checkbox"
                                className="nv-ptree-check"
                                checked={on(role.key, f)}
                                disabled={!editable || (capped(f) && !on(role.key, f))}
                                onChange={() => setPerm([f], !draft.permissions[f])}
                              />
                              <span className="nv-perm2-item-text">
                                <span className="nv-perm2-item-name">
                                  {featureLabel(f)}
                                  <code>{f}</code>
                                  {changed ? <em>未保存</em> : null}
                                </span>
                                <small>{capped(f) ? "超出本企业的权限上限，不能开通" : FEATURE_HINT[f]}</small>
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

      <Modal open={ceilingOpen} onClose={() => setCeilingOpen(false)} title="企业权限上限" busy={ceilingBusy} panelClassName="nv-prod-modal nv-sm-modal">
        <div className="nv-pform">
          <p className="nv-pform-intro">企业超管自建的角色最多能开哪些功能。收紧后，已有企业角色超出的部分立即失效；系统角色不受影响。</p>
          <div className="nv-pform-body">
            <label className="nv-pfield" htmlFor={`${baseId}-cent`}>
              <span className="nv-pfield-label">企业</span>
              <select id={`${baseId}-cent`} className="input" value={ceilingEnt} onChange={(e) => void openCeiling(e.target.value)}>
                {enterprises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="nv-agents-perms">
              {features.map((f) => (
                <label key={f.key}>
                  <input type="checkbox" checked={ceilingSet.includes(f.key)} onChange={(e) => setCeilingSet((c) => (e.target.checked ? [...c, f.key] : c.filter((x) => x !== f.key)))} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={ceilingBusy} onClick={() => void saveCeiling()}>
              {ceilingBusy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.mode === "rename" ? "编辑角色" : "新建角色"}
        dirty={Boolean(form && (form.mode === "create" ? form.name || form.description : form.name !== role.name || form.description !== (role.description || "")))}
        busy={formBusy}
        panelClassName="nv-prod-modal nv-sm-modal"
      >
        {form ? (
          <form onSubmit={submitForm} className="nv-pform" noValidate>
            <p className="nv-pform-intro">
              {form.mode === "create" ? "角色决定功能权限和数据范围。新角色先复制一个已有角色的配置，创建后再细调。" : "只改名称和说明，不影响权限配置。"}
            </p>
            <div className="nv-pform-body">
              {formError ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {formError}
                </div>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-rname`}>
                <span className="nv-pfield-label">角色名称</span>
                <input
                  id={`${baseId}-rname`}
                  className="input"
                  value={form.name}
                  maxLength={30}
                  placeholder="如：外包开发"
                  data-initial-focus=""
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="nv-pfield" htmlFor={`${baseId}-rdesc`}>
                <span className="nv-pfield-label">说明</span>
                <input
                  id={`${baseId}-rdesc`}
                  className="input"
                  value={form.description}
                  maxLength={100}
                  placeholder="选填，一句话说明这个角色的用途"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              {form.mode === "create" && createIn.length > 1 ? (
                <label className="nv-pfield" htmlFor={`${baseId}-rent`}>
                  <span className="nv-pfield-label">所属</span>
                  <select id={`${baseId}-rent`} className="input" value={form.enterpriseId} onChange={(e) => setForm({ ...form, enterpriseId: e.target.value })}>
                    {createIn.map((o) => (
                      <option key={o.id || "system"} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <span className="nv-pfield-hint">企业角色只在该企业可见、只能给该企业的人，权限不超过企业上限</span>
                </label>
              ) : null}
              {form.mode === "create" ? (
                <label className="nv-pfield" htmlFor={`${baseId}-rcopy`}>
                  <span className="nv-pfield-label">复制权限自</span>
                  <select id={`${baseId}-rcopy`} className="input" value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}>
                    {roles.filter((r) => !form.enterpriseId ? !r.enterpriseId : r.key !== "admin" && (!r.enterpriseId || r.enterpriseId === form.enterpriseId)).map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <span className="nv-pfield-hint">新角色的功能权限和数据范围先与「{copySource?.name || "成员"}」一致</span>
                </label>
              ) : null}
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">{form.mode === "create" ? "创建后在右侧调整数据权限和功能权限" : ""}</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={formBusy} aria-busy={formBusy || undefined}>
                {formBusy ? "保存中…" : form.mode === "create" ? "创建" : "保存"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
