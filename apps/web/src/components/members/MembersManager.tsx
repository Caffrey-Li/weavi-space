"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Plus, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { CORE_TEAM_ROLES, jobRoleLabel } from "@/lib/constants";
import { SYSTEM_ORG_ID, flattenOrgs, subtreeIds, type OrgRow } from "@/lib/org-shared";

type MemberRow = {
  id: string;
  role: string;
  openAssignments: number;
  user: { id: string; name: string; email: string; avatarUrl?: string | null; globalRole?: string | null; position?: string | null; orgId?: string };
};

type Candidate = { id: string; name: string; email: string; globalRole?: string; position?: string | null; orgId?: string };

/**
 * 项目成员：先按岗位筛，再勾选多人一次加入；加入时带出人员的默认岗位，项目内可单独调整。
 * 岗位只表示在本项目的职责，不影响权限（权限看账号的角色）。成员表按岗位分组，方便看出团队是否齐全。
 */
export function MembersManager({
  projectId,
  projectName,
  members,
  users,
  canManage,
  positions,
  orgs = [],
}: {
  /** 组织树：成员表显示所属组织，添加成员时可按组织（含下级）筛选 */
  orgs?: OrgRow[];
  /** 岗位选项（key + 名称） */
  positions: { key: string; name: string }[];
  projectId: string;
  projectName: string;
  members: MemberRow[];
  users: Candidate[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [tipOpen, setTipOpen] = useState(true);
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [jobFilter, setJobFilter] = useState<string>("");
  const [orgFilter, setOrgFilter] = useState<string>("");
  const orgPath = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return (id?: string) => {
      const parts: string[] = [];
      for (let o = byId.get(id || SYSTEM_ORG_ID); o && o.type !== "system"; o = o.parentId ? byId.get(o.parentId) : undefined) parts.unshift(o.name);
      return parts.join(" / ") || "Weavi Space";
    };
  }, [orgs]);
  const orgScope = useMemo(() => (orgFilter ? new Set(subtreeIds(orgs, orgFilter)) : null), [orgs, orgFilter]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const memberIds = useMemo(() => new Set(members.map((m) => m.user.id)), [members]);
  const pool = useMemo(() => users.filter((u) => !memberIds.has(u.id)), [users, memberIds]);
  const countByRole = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of pool) m[u.position || "member"] = (m[u.position || "member"] || 0) + 1;
    return m;
  }, [pool]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter(
      (u) =>
        (!jobFilter || (u.position || "member") === jobFilter) &&
        (!orgScope || orgScope.has(u.orgId || SYSTEM_ORG_ID)) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [pool, jobFilter, query, orgScope]);

  const grouped = useMemo(() => {
    const order = [...positions.map((p) => p.key), "member"];
    const map = new Map<string, MemberRow[]>();
    for (const m of members) {
      const r = m.role;
      if (!map.has(r)) map.set(r, []);
      map.get(r)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [members, positions]);

  const missing = (CORE_TEAM_ROLES as readonly string[]).filter((r) => !members.some((m) => m.role === r));

  async function changePosition(m: MemberRow, role: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: m.id, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "调整失败");
        return;
      }
      toast.success(`已把 ${m.user.name} 在本项目的岗位改为「${jobRoleLabel(role)}」`);
      router.refresh();
    } catch {
      toast.error("网络异常，结果未确认，请刷新后核对");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function add() {
    if (!picked.size || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(picked) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "添加失败");
        return;
      }
      toast.success(`已加入 ${(data as { added?: number }).added ?? picked.size} 人，岗位按各自的默认岗位带入`);
      setPicked(new Set());
      setAdding(false);
      router.refresh();
    } catch {
      setError("网络异常，结果未确认，请刷新后核对成员列表");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MemberRow) {
    const ok = await confirm({
      title: `把 ${m.user.name} 移出项目？`,
      tone: "danger",
      confirmLabel: "移出项目",
      body: (
        <div className="space-y-2">
          <p>只是从本项目成员列表移除：账号、历史动态都保留，账号状态不变。</p>
          {m.openAssignments > 0 ? (
            <p className="text-nv-danger-fg">
              TA 仍是本项目 {m.openAssignments} 条未完成需求的负责人，移出后这些需求的负责人不会自动更换，请记得重新指派。
            </p>
          ) : null}
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: m.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "移除失败");
        return;
      }
      toast.success(`已将 ${m.user.name} 移出项目`);
      router.refresh();
    } catch {
      toast.error("网络异常，结果未确认，请刷新后核对");
    } finally {
      setBusy(false);
    }
  }

  const sortedMembers = grouped.flatMap(([, list]) => list);

  return (
    <div className="page">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">项目成员</h1>
          <p className="page-summary">
            {projectName} · 岗位是成员在本项目的职责，可单独调整，不影响权限；需求负责人从项目成员里按岗位挑选。
          </p>
        </div>
        {canManage ? (
          <div className="page-actions">
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              添加成员
            </button>
          </div>
        ) : null}
      </header>

      {missing.length ? (
        <p className="notice mt-6">
          团队还缺：<strong>{missing.map(jobRoleLabel).join("、")}</strong>。缺岗位会导致对应的需求负责人无人可选。
        </p>
      ) : null}

      <section className="card req-table-card mt-6 overflow-x-auto">
        {members.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">暂无项目成员{canManage ? "，点右上角「添加成员」按岗位加入。" : "。"}</p>
        ) : (
          <table className="table-compact member-table w-full min-w-[640px]">
            <caption className="sr-only">项目成员，共 {members.length} 人</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[26%]">成员</th>
                <th scope="col" className="w-[28%]">所属组织</th>
                <th scope="col" className="w-[18%]">项目岗位</th>
                <th scope="col" className="w-[14%]">未完成需求</th>
                <th scope="col" className="w-[14%]">操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={m.user.name} src={m.user.avatarUrl} size={24} />
                      <span className="truncate font-medium">{m.user.name}</span>
                    </div>
                  </td>
                  <td className="truncate text-secondary" title={m.user.email}>{orgPath(m.user.orgId)}</td>
                  <td>
                    {canManage ? (
                      <select
                        className="input h-8 min-h-0 py-0"
                        aria-label={`${m.user.name} 在本项目的岗位`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void changePosition(m, e.target.value)}
                      >
                        <option value="member">未设置岗位</option>
                        {positions.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      jobRoleLabel(m.role)
                    )}
                  </td>
                  <td className="tabular-nums">{m.openAssignments || "—"}</td>
                  <td>
                    {canManage ? (
                      <button type="button" className="link-button" disabled={busy} onClick={() => void remove(m)}>
                        移除成员
                      </button>
                    ) : (
                      <span className="text-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canManage && tipOpen ? (
        <div className="info-banner" role="note">
          <Info size={18} aria-hidden="true" className="info-banner-icon" />
          <div className="min-w-0 flex-1">
            <p className="info-banner-title">从已有用户中添加成员</p>
            <p className="info-banner-body">
              需要新增账号时，请前往{" "}
              <Link href="/members" className="text-link">
                成员管理
              </Link>
              。
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭提示" onClick={() => setTipOpen(false)}>
            <X size={16} />
          </button>
        </div>
      ) : null}
      {!canManage ? <p className="empty-inline">当前账号没有「管理项目成员」权限，仅可查看。</p> : null}

      {canManage ? (
        <Modal open={adding} onClose={() => setAdding(false)} title="添加成员" wide dirty={picked.size > 0} busy={busy}>
          <div>
          <p className="mb-3 text-xs text-neutral-500">
            先选岗位，再勾选人员，可一次加多人。加入后按各自的默认岗位带入，可在成员表里单独调整；默认岗位在{" "}
            <Link href="/members" className="text-brand-600 hover:underline">
              成员管理
            </Link>
            中维护。
          </p>
          {error ? (
            <div role="alert" className="banner-error mb-3">
              {error}
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="按岗位筛选待选人员">
            <button
              type="button"
              className={`filter-chip ${!jobFilter ? "filter-chip-active" : ""}`}
              aria-pressed={!jobFilter}
              onClick={() => setJobFilter("")}
            >
              全部岗位 <span className="ml-1 text-xs opacity-70">{pool.length}</span>
            </button>
            {[...positions.map((p) => p.key), "member"].map((role) => (
              <button
                key={role}
                type="button"
                className={`filter-chip ${jobFilter === role ? "filter-chip-active" : ""}`}
                aria-pressed={jobFilter === role}
                onClick={() => setJobFilter(role)}
                disabled={!countByRole[role]}
              >
                {jobRoleLabel(role)} <span className="ml-1 text-xs opacity-70">{countByRole[role] || 0}</span>
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {orgs.length > 1 ? (
              <select className="input max-w-[220px]" aria-label="按组织筛选待选人员" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">全部组织</option>
                {flattenOrgs(orgs).map((o) => (
                  <option key={o.id} value={o.id}>
                    {"　".repeat(o.depth)}
                    {o.name}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="input max-w-[260px]"
              placeholder="按姓名或账号搜索"
              aria-label="按姓名或账号搜索人员"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={!candidates.length}
              onClick={() =>
                setPicked((s) => {
                  const n = new Set(s);
                  const all = candidates.every((c) => n.has(c.id));
                  for (const c of candidates) {
                    if (all) n.delete(c.id);
                    else n.add(c.id);
                  }
                  return n;
                })
              }
            >
              {candidates.length && candidates.every((c) => picked.has(c.id)) ? "取消全选" : "全选当前"}
            </button>
          </div>
          {candidates.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 px-3 py-4 text-sm text-neutral-500">
              {pool.length === 0 ? "所有在职人员都已在项目中。" : `「${jobRoleLabel(jobFilter)}」岗位暂无可添加的人员。`}
            </p>
          ) : (
            <ul className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
              {candidates.map((u) => (
                <li key={u.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm ${
                      picked.has(u.id) ? "border-brand-300 bg-brand-50" : "border-neutral-200 hover:bg-neutral-50"
                    }`}
                  >
                    <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                    <Avatar name={u.name} size={22} />
                    <span className="min-w-0 flex-1 truncate">
                      {u.name}
                      <span className="ml-1 text-xs text-neutral-500">{u.email}</span>
                    </span>
                    <span className="nv-tag is-dot is-neutral nv-job-tag" data-role={u.position || "member"}>
                      {jobRoleLabel(u.position)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-end gap-3">
            <span className="text-sm text-neutral-500" aria-live="polite">
              已选 {picked.size} 人
            </span>
            <button type="button" className="btn-primary" disabled={!picked.size || busy} aria-busy={busy || undefined} onClick={() => void add()}>
              {busy ? "添加中…" : `加入项目${picked.size ? `（${picked.size}）` : ""}`}
            </button>
          </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
