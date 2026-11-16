"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Network, Search, Shield } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Avatar } from "@/components/ui/Avatar";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { dataScopeLabel } from "@/lib/roles-shared";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { notifyOrgsChanged } from "@/components/members/OrgNav";
import { SYSTEM_ORG_ID, flattenOrgs, subtreeIds, type OrgRow } from "@/lib/org-shared";

type RoleOpt = { key: string; name: string; dataScope: string; featureCount: number };
type PosOpt = { key: string; name: string };
type BatchKind = "org" | "role" | "position";
const BATCH_LABEL: Record<BatchKind, string> = { org: "组织", role: "角色", position: "岗位" };

type UserRow = {
  id: string;
  name: string;
  email: string;
  globalRole: string;
  /** 默认岗位（Position.key） */
  position: string | null;
  isActive: boolean;
  avatarUrl?: string | null;
  orgId: string;
  /** 手机号脱敏值 */
  phone?: string;
  /** 还没有密码：邀请未接受或刚被重置 */
  pending?: boolean;
  projectMembers: { id: string; role: string; project: { id: string; key: string; name: string; iconUrl?: string | null } }[];
};

const emptyCreate = { name: "", account: "", phone: "", globalRole: "member", position: "", orgId: SYSTEM_ORG_ID };
const emptyEdit = { name: "", account: "", phone: "", globalRole: "member", position: "", orgId: SYSTEM_ORG_ID };

export function UserAdmin({
  users: initial,
  canManage,
  currentUserId,
  manageableRoles,
  assignableRoles,
  orgs: initialOrgs,
  selectedOrg,
  openCreate = false,
  roles,
  positions,
  featureTotal,
  enterpriseAdminIds = [],
  lockedUserIds = [],
}: {
  /** 企业超管的账号（标记用） */
  enterpriseAdminIds?: string[];
  /** 不能在成员页修改的账号（非系统超管看企业超管） */
  lockedUserIds?: string[];
  /** 角色（功能权限 + 数据范围） */
  roles: RoleOpt[];
  /** 岗位（项目职责） */
  positions: PosOpt[];
  featureTotal: number;
  /** 侧栏组织树选中的组织（/members?org=），默认系统组织 */
  selectedOrg?: string;
  users: UserRow[];
  canManage: boolean;
  currentUserId: string;
  /** 当前操作者能管理哪些角色的账号（级别比自己低的） */
  manageableRoles: string[];
  /** 当前操作者能把别人设为哪些角色 */
  assignableRoles: string[];
  orgs: OrgRow[];
  /** 侧栏「添加账号」带 ?new=1 进来时直接打开新建弹窗 */
  openCreate?: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  const confirm = useConfirm();
  const toast = useToast();
  const [users, setUsers] = useState(initial);
  useEffect(() => {
    setUsers(initial);
  }, [initial]);
  const [orgs, setOrgs] = useState(initialOrgs);
  useEffect(() => {
    setOrgs(initialOrgs);
  }, [initialOrgs]);
  const orgFilter = selectedOrg && initialOrgs.some((o) => o.id === selectedOrg) ? selectedOrg : SYSTEM_ORG_ID;
  const orgOptions = useMemo(() => flattenOrgs(orgs), [orgs]);
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  /** 账号的组织路径（不含系统组织），如「星河科技 / 产品部」 */
  const orgPath = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return (id: string) => {
      const parts: string[] = [];
      for (let o = byId.get(id); o && o.type !== "system"; o = o.parentId ? byId.get(o.parentId) : undefined) parts.unshift(o.name);
      return parts.join(" / ");
    };
  }, [orgs]);
  const [createOpen, setCreateOpen] = useState(canManage && openCreate);
  const [editOpen, setEditOpen] = useState<UserRow | null>(null);
  const [pwdOpen, setPwdOpen] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyCreate);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  /** 邀请 / 重置链接：只在这次弹窗里显示，用来复制发给对方 */
  const [shownLink, setShownLink] = useState<{ name: string; link: string; emailed: boolean; context: "create" | "reset" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [orgFilter]);
  const [pageSize, setPageSize] = useState(100);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const roleName = useMemo(() => new Map(roles.map((r) => [r.key, r.name])), [roles]);
  const canTouch = (u: { id?: string; globalRole: string }) =>
    canManage && manageableRoles.includes(u.globalRole) && !(u.id && lockedUserIds.includes(u.id));
  // 下拉里保留账号当前的角色，否则打开编辑时会被静默改掉
  const roleChoices = (current?: string) => roles.filter((r) => assignableRoles.includes(r.key) || r.key === current);
  const posName = useMemo(() => new Map(positions.map((p) => [p.key, p.name])), [positions]);
  const roleHint = (key: string) => {
    const r = roles.find((x) => x.key === key);
    return r ? `数据范围：${dataScopeLabel(r.dataScope)} · 已开通 ${r.key === "admin" ? featureTotal : r.featureCount} / ${featureTotal} 项功能` : undefined;
  };
  // 批量调整
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<null | { kind: BatchKind; value: string }>(null);
  const [batchError, setBatchError] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  useEffect(() => {
    if (!openCreate || !canManage) return;
    setCreateOpen(true);
    router.replace(selectedOrg ? `/members?org=${encodeURIComponent(selectedOrg)}` : "/members", { scroll: false });
  }, [openCreate, canManage, router, selectedOrg]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inOrg = new Set(subtreeIds(orgs, orgFilter));
    return users.filter(
      (u) =>
        inOrg.has(orgName.has(u.orgId) ? u.orgId : SYSTEM_ORG_ID) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        (!statusFilter || (statusFilter === "active" ? u.isActive : !u.isActive)) &&
        (!jobFilter || (jobFilter === "__none__" ? !u.position : u.position === jobFilter)) &&
        (!roleFilter || u.globalRole === roleFilter),
    );
  }, [users, query, statusFilter, jobFilter, roleFilter, orgs, orgFilter, orgName]);
  // 筛选变化后，只保留仍在结果里的勾选
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(filtered.map((u) => u.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedUsers = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        account: form.account,
        phone: form.phone,
        globalRole: form.globalRole,
        position: form.position,
        orgId: form.orgId,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg(data.error || "创建失败");
      return;
    }
    setCreateOpen(false);
    setForm(emptyCreate);
    setShownLink({ name: data.user?.name || form.name, link: data.inviteLink, emailed: Boolean(data.emailed), context: "create" });
    setCopied(false);
    router.refresh();
    notifyOrgsChanged();
  }

  function openEdit(u: UserRow) {
    setEditOpen(u);
    setEditForm({
      name: u.name,
      account: u.email,
      phone: "",
      globalRole: u.globalRole,
      position: u.position || "",
      orgId: orgName.has(u.orgId) ? u.orgId : SYSTEM_ORG_ID,
    });
    setMsg("");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editOpen) return;
    setSaving(true);
    setMsg("");
    const patch: Record<string, unknown> = {
      name: editForm.name,
      account: editForm.account,
      globalRole: editForm.globalRole,
      position: editForm.position,
      orgId: editForm.orgId,
    };
    // 手机号只回传脱敏值：没重新填写就不改
    if (editForm.phone.trim()) patch.phone = editForm.phone;
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editOpen.id, ...patch }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg(data.error || "更新失败");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === editOpen.id ? { ...u, ...data.user } : u)));
    setEditOpen(null);
    setMsg(`已更新 ${data.user?.name || editForm.name}`);
    router.refresh();
    notifyOrgsChanged();
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    setMsg("");
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "更新失败");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...data.user } : u)));
    router.refresh();
  }

  async function deleteUser(u: UserRow) {
    const ok = await confirm({
      title: `删除账号「${u.name}」？`,
      body: "账号会从所有项目里移除，删除后不能恢复。只想暂时禁止登录的话，用「停用账号」。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    toast.success(`已删除账号「${u.name}」`);
    router.refresh();
    notifyOrgsChanged();
  }

  function openCreateUser() {
    setMsg("");
    setForm({ ...emptyCreate, orgId: orgFilter });
    setCreateOpen(true);
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwdOpen) return;
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pwdOpen.id, resetPassword: true }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg(data.error || "重置失败");
      return;
    }
    const name = pwdOpen.name;
    setPwdOpen(null);
    setUsers((prev) => prev.map((u) => (u.id === data.user?.id ? { ...u, pending: true } : u)));
    setShownLink({ name, link: data.resetLink, emailed: Boolean(data.emailed), context: "reset" });
    setCopied(false);
  }

  const pageIds = pagedUsers.filter(canTouch).map((u) => u.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const selectedUsers = users.filter((u) => selected.has(u.id));
  const selectedNames = selectedUsers.slice(0, 5).map((u) => u.name).join("、") + (selectedUsers.length > 5 ? ` 等 ${selectedUsers.length} 人` : "");

  function openBatch(kind: BatchKind) {
    setBatchError("");
    const first = selectedUsers[0];
    const same = <T,>(get: (u: UserRow) => T) => (selectedUsers.every((u) => get(u) === get(first)) ? get(first) : undefined);
    const value =
      kind === "org"
        ? (same((u) => (orgName.has(u.orgId) ? u.orgId : SYSTEM_ORG_ID)) as string | undefined) ?? orgFilter
        : kind === "role"
          ? (same((u) => u.globalRole) as string | undefined) ?? "member"
          : (same((u) => u.position || "") as string | undefined) ?? "";
    setBatch({ kind, value });
  }

  async function submitBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!batch || batchBusy) return;
    setBatchBusy(true);
    setBatchError("");
    const field = batch.kind === "org" ? "orgId" : batch.kind === "role" ? "globalRole" : "position";
    const res = await fetch("/api/users/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), [field]: batch.value }),
    });
    const data = await res.json().catch(() => ({}));
    setBatchBusy(false);
    if (!res.ok) {
      setBatchError(data.error || "调整失败");
      return;
    }
    setUsers((prev) =>
      prev.map((u) =>
        selected.has(u.id)
          ? { ...u, ...(batch.kind === "org" ? { orgId: batch.value } : batch.kind === "role" ? { globalRole: batch.value } : { position: batch.value || null }) }
          : u,
      ),
    );
    toast.success(`已调整 ${data.count ?? selected.size} 人的${BATCH_LABEL[batch.kind]}`);
    setBatch(null);
    setSelected(new Set());
    router.refresh();
    if (batch.kind === "org") notifyOrgsChanged();
  }

  async function copyTemp() {
    if (!shownLink) return;
    try {
      await navigator.clipboard.writeText(shownLink.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader
          crumbs={[
            // 从「组织架构」点「查看成员」进来时：成员管理 › 组织名，点「成员管理」回到全部
            { label: "成员管理", icon: "users", href: "/members" },
            ...(orgFilter !== SYSTEM_ORG_ID ? [{ label: orgName.get(orgFilter) || "" }] : []),
          ]}
          count={filtered.length}
          actions={
            <>
              <label className="nv-head-search is-static">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="搜索姓名或账号"
                  aria-label="按姓名或账号搜索成员"
                />
              </label>
              <select className="input nv-head-select" aria-label="角色" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
                <option value="">全部角色</option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select className="input nv-head-select" aria-label="岗位" value={jobFilter} onChange={(e) => { setJobFilter(e.target.value); setPage(1); }}>
                <option value="">全部岗位</option>
                {positions.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
                <option value="__none__">未设置岗位</option>
              </select>
              <select className="input nv-head-select" aria-label="账号状态" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">全部状态</option>
                <option value="active">已启用</option>
                <option value="inactive">已停用</option>
              </select>
              {canManage ? (
                <button type="button" className="btn-primary nv-head-btn" onClick={openCreateUser}>
                  邀请成员
                </button>
              ) : null}
            </>
          }
        />
        {msg && !createOpen && !editOpen && !pwdOpen && !shownLink ? <div role="status" className="banner-success nv-notice">{msg}</div> : null}
        {canManage && selected.size ? (
          <div className="nv-batch-bar" role="toolbar" aria-label="批量调整">
            <span className="nv-batch-count">已选 {selected.size} 人</span>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => openBatch("org")}>
              <Network size={14} aria-hidden="true" />
              调整组织
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => openBatch("role")}>
              <Shield size={14} aria-hidden="true" />
              调整角色
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => openBatch("position")}>
              <Briefcase size={14} aria-hidden="true" />
              调整岗位
            </button>
            <span className="flex-1" />
            <button type="button" className="btn-ghost nv-head-btn" onClick={() => setSelected(new Set())}>
              取消选择
            </button>
          </div>
        ) : null}
      </div>

      <div className="list-table-scroll nv-list-scroll">
        <div className="nv-member-table" role="table" aria-label={`成员列表，共 ${filtered.length} 人`}>
          <div className={`nv-member-row is-head${canManage ? " has-check" : ""}`} role="row">
            {canManage ? (
              <span role="columnheader">
                <input
                  type="checkbox"
                  className="nv-ptree-check"
                  aria-label="选择本页全部成员"
                  checked={allOnPage}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPage && someOnPage;
                  }}
                  onChange={toggleAll}
                />
              </span>
            ) : null}
            <span role="columnheader">成员</span>
            <span role="columnheader">所属组织</span>
            <span role="columnheader">角色</span>
            <span role="columnheader">岗位</span>
            <span role="columnheader">所属项目</span>
            <span role="columnheader">状态</span>
            <span role="columnheader"><span className="sr-only">操作</span></span>
          </div>
          {pagedUsers.map((u) => (
            <div key={u.id} className={`nv-member-row${canManage ? " has-check" : ""}${selected.has(u.id) ? " is-selected" : ""}`} role="row">
              {canManage ? (
                <span role="cell">
                  <input type="checkbox" className="nv-ptree-check" aria-label={`选择 ${u.name}`} checked={selected.has(u.id)} disabled={!canTouch(u)} onChange={() => toggle(u.id)} />
                </span>
              ) : null}
              <span role="cell" className="nv-member-who">
                <Avatar name={u.name} src={u.avatarUrl} size={24} />
                <span className="min-w-0">
                  <span className="nv-member-name">{u.name}</span>
                  <span className="nv-member-acc">
                    {u.email}
                    {u.phone ? ` · ${u.phone}` : ""}
                    {u.pending ? <span className="nv-tag is-warning nv-pending-tag">待激活</span> : null}
                  </span>
                </span>
              </span>
              <span role="cell" className="nv-member-text nv-member-org" title={orgPath(u.orgId) || "Weavi Space"}>
                {orgPath(u.orgId) || <span className="text-tertiary">Weavi Space</span>}
              </span>
              <span role="cell" className="nv-member-text">
                {roleName.get(u.globalRole) || u.globalRole}
                {enterpriseAdminIds.includes(u.id) ? <span className="nv-tag is-purple nv-entadmin-tag">企业超管</span> : null}
              </span>
              <span role="cell">
                {u.position ? (
                  <span className="nv-tag is-dot is-neutral nv-job-tag" data-role={u.position}>{posName.get(u.position) || u.position}</span>
                ) : (
                  <span className="nv-member-text text-tertiary">未设置</span>
                )}
              </span>
              <span role="cell" className="nv-member-projects" title={u.projectMembers.map((m) => m.project.name).join("、") || undefined}>
                {["all", "enterprise"].includes(roles.find((r) => r.key === u.globalRole)?.dataScope || "") ? (
                  <span className="nv-member-text">全部项目</span>
                ) : u.projectMembers.length ? (
                  <>
                    {u.projectMembers.slice(0, 3).map((m) => (
                      <ProjectIcon key={m.id} name={m.project.name} src={m.project.iconUrl} size={16} />
                    ))}
                    <span className="nv-member-text">{u.projectMembers.length} 个</span>
                  </>
                ) : (
                  <span className="text-tertiary">—</span>
                )}
              </span>
              <span role="cell">
                <span className={`nv-tag is-dot ${u.isActive ? "is-success" : "is-neutral"}`}>{u.isActive ? "已启用" : "已停用"}</span>
              </span>
              <span role="cell" className="nv-member-more">
                {canTouch(u) ? (
                  <ActionMenu
                    label={`${u.name} 的更多操作`}
                    items={[
                      { label: "编辑", onSelect: () => openEdit(u) },
                      { label: u.pending ? "重新发送邀请 / 重置链接" : "重置密码", onSelect: () => { setMsg(""); setPwdOpen(u); } },
                      u.isActive
                        ? { label: "停用账号", tone: "danger", disabled: u.id === currentUserId, onSelect: () => void patchUser(u.id, { isActive: false }) }
                        : { label: "启用账号", onSelect: () => void patchUser(u.id, { isActive: true }) },
                      { label: "删除账号", tone: "danger", disabled: u.id === currentUserId, onSelect: () => void deleteUser(u) },
                    ]}
                  />
                ) : null}
              </span>
            </div>
          ))}
          {pagedUsers.length === 0 ? (
            <p className="empty-inline nv-member-empty">
              {query || statusFilter || jobFilter || roleFilter ? "没有符合条件的成员。" : `「${orgName.get(orgFilter) ?? ""}」还没有账号。`}
            </p>
          ) : null}
        </div>
      </div>
      {filtered.length > pageSize ? (
        <div className="nv-list-foot">
          <Pagination
            total={filtered.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="邀请成员"
        dirty={!!(form.name || form.account || form.phone)}
        busy={saving}
      >
        <form onSubmit={createUser} className="space-y-3">
          {msg && createOpen ? (
            <div role="alert" className="banner-error" tabIndex={-1}>{msg}</div>
          ) : null}
          <Field id={`${baseId}-c-name`} label="姓名" required>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <p className="text-xs text-neutral-500">
            管理员不设置密码：创建后会生成 7 天有效的邀请链接（配置了邮件时同时发到邮箱），对方打开链接、核对邮箱即可登录，首次登录时自己设置密码。
          </p>
          <Field id={`${baseId}-c-account`} label="邮箱（登录账号）" required>
            <input
              className="input"
              required
              type="email"
              placeholder="name@example.com"
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field id={`${baseId}-c-phone`} label="手机号" hint="选填；开通手机验证码登录后可用手机号登录，加密保存">
            <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" />
          </Field>
          <Field id={`${baseId}-c-role`} label="角色" hint={roleHint(form.globalRole)}>
            <select className="input" value={form.globalRole} onChange={(e) => setForm({ ...form, globalRole: e.target.value })}>
              {roleChoices().map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-c-pos`} label="默认岗位" hint="加入项目时带出，项目内可单独调整；不影响权限">
            <select className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">不设置</option>
              {positions.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-c-org`} label="所属组织">
            <select className="input" value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>{"　".repeat(o.depth)}{o.name}</option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>{saving ? "保存中…" : "创建并生成邀请链接"}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editOpen}
        onClose={() => setEditOpen(null)}
        title={`编辑用户 · ${editOpen?.name || ""}`}
        dirty={
          !!editOpen &&
          (editForm.name !== editOpen.name ||
            editForm.account !== editOpen.email ||
            editForm.globalRole !== editOpen.globalRole ||
            editForm.position !== (editOpen.position || "") ||
            editForm.orgId !== (orgName.has(editOpen.orgId) ? editOpen.orgId : SYSTEM_ORG_ID) ||
            !!editForm.phone)
        }
        busy={saving}
      >
        <form onSubmit={saveEdit} className="space-y-3">
          {msg && editOpen ? (
            <div role="alert" className="banner-error" tabIndex={-1}>{msg}</div>
          ) : null}
          <Field id={`${baseId}-e-name`} label="姓名" required>
            <input
              className="input"
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          <Field id={`${baseId}-e-account`} label="账号" required>
            <input
              className="input"
              required
              placeholder="邮箱 / 手机号 / 自定义"
              value={editForm.account}
              onChange={(e) => setEditForm({ ...editForm, account: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field id={`${baseId}-e-phone`} label="手机号" hint={editOpen?.phone ? `当前 ${editOpen.phone}；留空不修改` : "选填，加密保存"}>
            <input
              className="input"
              inputMode="tel"
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              autoComplete="off"
              placeholder={editOpen?.phone ? "填写新手机号以替换" : ""}
            />
          </Field>
          <Field id={`${baseId}-e-role`} label="角色" hint={roleHint(editForm.globalRole)}>
            <select
              className="input"
              value={editForm.globalRole}
              onChange={(e) => setEditForm({ ...editForm, globalRole: e.target.value })}
            >
              {roleChoices(editOpen?.globalRole).map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-e-pos`} label="默认岗位" hint="只影响之后加入的项目；已加入项目的岗位在项目成员里调整">
            <select className="input" value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}>
              <option value="">不设置</option>
              {positions.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field id={`${baseId}-e-org`} label="所属组织">
            <select className="input" value={editForm.orgId} onChange={(e) => setEditForm({ ...editForm, orgId: e.target.value })}>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>{"　".repeat(o.depth)}{o.name}</option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(null)} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>{saving ? "保存中…" : "保存"}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!pwdOpen}
        onClose={() => setPwdOpen(null)}
        title={`重置密码 · ${pwdOpen?.name || ""}`}
        busy={saving}
      >
        <form onSubmit={resetPassword} className="space-y-3">
          {msg && pwdOpen ? (
            <div role="alert" className="banner-error" tabIndex={-1}>{msg}</div>
          ) : null}
          <p className="text-sm text-neutral-700">
            管理员看不到也设置不了密码。确定后 <strong>{pwdOpen?.name}</strong> 的旧密码立即失效、所有设备下线，系统生成 24 小时有效的重置链接（配置了邮件时同时发到对方邮箱）。
          </p>
          <p className="text-xs text-neutral-500">对方也可以用已绑定的飞书 / 企业微信 / 钉钉，或邮箱、手机验证码登录，登录后设置新密码。</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPwdOpen(null)} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>{saving ? "处理中…" : "重置并生成链接"}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(batch)}
        onClose={() => setBatch(null)}
        title={batch ? `批量调整${BATCH_LABEL[batch.kind]}` : ""}
        busy={batchBusy}
        panelClassName="nv-prod-modal nv-sm-modal"
      >
        {batch ? (
          <form onSubmit={submitBatch} className="nv-pform" noValidate>
            <p className="nv-pform-intro">已选 {selected.size} 人：{selectedNames}</p>
            <div className="nv-pform-body">
              {batchError ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {batchError}
                </div>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-batch`}>
                <span className="nv-pfield-label">{batch.kind === "org" ? "所属组织" : batch.kind === "role" ? "角色" : "默认岗位"}</span>
                <select id={`${baseId}-batch`} className="input" value={batch.value} data-initial-focus="" onChange={(e) => setBatch({ ...batch, value: e.target.value })}>
                  {batch.kind === "org"
                    ? orgOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {"　".repeat(o.depth)}
                          {o.name}
                        </option>
                      ))
                    : batch.kind === "role"
                      ? roleChoices().map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))
                      : [{ key: "", name: "不设置" }, ...positions].map((p) => (
                          <option key={p.key || "none"} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                </select>
                {batch.kind === "role" ? <span className="nv-pfield-hint">{roleHint(batch.value)}</span> : null}
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">
                {batch.kind === "org"
                  ? "只改所属组织，不影响角色和岗位"
                  : batch.kind === "role"
                    ? "只改角色，不影响所属组织、岗位和项目内岗位"
                    : "只改默认岗位，已加入项目的岗位不变"}
              </span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={batchBusy} aria-busy={batchBusy || undefined}>
                {batchBusy ? "保存中…" : "确定调整"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={!!shownLink}
        onClose={() => setShownLink(null)}
        title={shownLink?.context === "create" ? "邀请已生成" : "重置链接已生成"}
      >
        {shownLink && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-700">
              {shownLink.emailed ? "已发送到对方邮箱。" : "还没有配置邮件发送，"}请把链接发给 <strong>{shownLink.name}</strong>
              {shownLink.context === "reset" ? "：打开后核对邮箱即可登录并设置新密码，24 小时内有效。" : "：打开后核对邮箱即可登录，首次登录时设置密码，7 天内有效。"}
            </p>
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
              <div className="text-xs text-neutral-500">{shownLink.context === "reset" ? "重置链接" : "邀请链接"}（只显示这一次）</div>
              <div className="mt-1 break-all font-mono text-sm text-neutral-900 select-all">{shownLink.link}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={copyTemp}>
                {copied ? "已复制" : "复制链接"}
              </button>
              <button type="button" className="btn-primary" onClick={() => setShownLink(null)}>
                关闭
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
