"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { fmtDate } from "@/lib/utils";

export type NovaAdminRow = { id: string; name: string; email: string; isActive: boolean; createdAt: string; self: boolean };

/**
 * Weavi Space 系统后台 · 系统超管账号：设为系统超管会把账号移到系统组织 Weavi Space；
 * 取消时降为成员。不能取消自己，至少保留一个启用的系统超管；企业超管不能兼任。
 */
export function NovaAdmins({ admins: initial }: { admins: NovaAdminRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; name: string; email: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function openAdd() {
    setOpen(true);
    setPick("");
    setError("");
    setCandidates(null);
    const res = await fetch("/api/nova/admins/candidates");
    const data = await res.json().catch(() => ({}));
    setCandidates(res.ok ? data.users || [] : []);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!pick) return setError("请选择账号");
    const who = candidates?.find((u) => u.id === pick);
    const ok = await confirm({
      title: `把「${who?.name || ""}」设为系统超管？`,
      body: "系统超管能看到和修改所有企业的数据。账号会移到 Weavi Space 系统组织，需要重新登录。",
      confirmLabel: "设为系统超管",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/nova/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: pick }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "保存失败");
    toast.success(`已把「${who?.name || ""}」设为系统超管`);
    setOpen(false);
    router.refresh();
  }

  async function revoke(a: NovaAdminRow) {
    const ok = await confirm({ title: `取消「${a.name}」的系统超管？`, body: "取消后对方降为成员、需要重新登录，可在「成员管理」里再调整组织和角色。", confirmLabel: "取消系统超管", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/nova/admins?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "操作失败");
    setRows((prev) => prev.filter((x) => x.id !== a.id));
    toast.success(`已取消「${a.name}」的系统超管`);
    router.refresh();
  }

  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader
          crumbs={[{ label: "系统超管", icon: "shield" }]}
          count={rows.length}
          actions={
            <button type="button" className="btn-primary nv-head-btn" onClick={() => void openAdd()}>
              添加系统超管
            </button>
          }
        />
      </div>
      <p className="nv-pos-note" role="note">
        <Info size={14} aria-hidden="true" />
        系统超管管理整个 Weavi Space 系统：企业、企业超管、角色权限和系统设置，能看到所有企业的数据。
      </p>
      <div className="list-table-scroll nv-list-scroll">
        <div className="nv-pos-table" role="table" aria-label={`系统超管，共 ${rows.length} 人`}>
          <div className="nv-pos-row nv-nova-admin-row is-head" role="row">
            <span role="columnheader">姓名</span>
            <span role="columnheader">账号</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">创建时间</span>
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {rows.map((a) => (
            <div key={a.id} className="nv-pos-row nv-nova-admin-row" role="row">
              <span role="cell" className="nv-pos-name">
                <b>{a.name}</b>
                {a.self ? <span className="nv-tag is-info">我</span> : null}
              </span>
              <span role="cell" className="nv-pos-desc">{a.email}</span>
              <span role="cell">
                <span className={`nv-tag ${a.isActive ? "is-success" : "is-neutral"}`}>{a.isActive ? "启用" : "停用"}</span>
              </span>
              <span role="cell">{fmtDate(a.createdAt)}</span>
              <span role="cell" className="nv-member-more">
                <ActionMenu label={`${a.name} 的更多操作`} items={[{ label: "取消系统超管", tone: "danger", disabled: a.self, onSelect: () => void revoke(a) }]} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="添加系统超管" dirty={Boolean(pick)} busy={busy} panelClassName="nv-prod-modal nv-sm-modal">
        <form onSubmit={add} className="nv-pform" noValidate>
          <p className="nv-pform-intro">从已有账号里选择。企业超管不能兼任系统超管。</p>
          <div className="nv-pform-body">
            {error ? (
              <div role="alert" className="banner-error" tabIndex={-1}>
                {error}
              </div>
            ) : null}
            <label className="nv-pfield" htmlFor={`${baseId}-pick`}>
              <span className="nv-pfield-label">账号</span>
              <select id={`${baseId}-pick`} className="input" value={pick} disabled={!candidates} data-initial-focus="" onChange={(ev) => setPick(ev.target.value)}>
                <option value="">{candidates ? "请选择" : "加载中…"}</option>
                {(candidates || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{u.email}）
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "保存中…" : "添加"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
