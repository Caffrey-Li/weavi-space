"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Info } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export type NovaEnterpriseRow = {
  id: string;
  name: string;
  code: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string; isActive: boolean } | null;
  memberCount: number;
  projectCount: number;
};
type Candidate = { id: string; name: string; email: string; globalRole: string };

const CODE_HINT = "小写字母开头，可用小写字母、数字、短横线，2～32 位；用于专属登录链接";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Weavi Space 系统后台 · 企业管理（只有系统超管）：企业名称、企业编码（专属登录链接）、唯一的企业超级管理员。
 * 部门和删除企业在「组织架构」页。
 */
export function NovaEnterprises({ enterprises: initial }: { enterprises: NovaEnterpriseRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const baseId = useId();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [form, setForm] = useState<null | { id?: string; name: string; code: string }>(null);
  const [adminFor, setAdminFor] = useState<NovaEnterpriseRow | null>(null);
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState("");
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "" });
  const [temp, setTemp] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editing = form?.id ? rows.find((r) => r.id === form.id) : undefined;
  const loginLink = (code: string) => `${origin}/login?org=${encodeURIComponent(code)}`;

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    if (!form.name.trim()) return setError("请填写企业名称");
    if (!form.code.trim()) return setError("请填写企业编码");
    setBusy(true);
    setError("");
    const res = await fetch(form.id ? `/api/nova/enterprises/${encodeURIComponent(form.id)}` : "/api/nova/enterprises", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, code: form.code }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "保存失败");
    toast.success(form.id ? "已更新企业" : `已新建企业「${form.name.trim()}」，请指定企业超管`);
    setForm(null);
    router.refresh();
  }

  async function openAdmin(row: NovaEnterpriseRow) {
    setAdminFor(row);
    setError("");
    setTemp(null);
    setPick(row.admin?.id || "");
    setNewAdmin({ name: "", email: "" });
    setCandidates(null);
    const res = await fetch(`/api/nova/enterprises/${encodeURIComponent(row.id)}/candidates`);
    const data = await res.json().catch(() => ({}));
    const list: Candidate[] = res.ok ? data.users || [] : [];
    setCandidates(list);
    setMode(list.length ? "pick" : "new");
  }

  async function submitAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminFor || busy) return;
    if (mode === "pick" && !pick) return setError("请选择账号");
    if (mode === "new" && (!newAdmin.name.trim() || !newAdmin.email.trim())) return setError("请填写姓名和邮箱");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/nova/enterprises/${encodeURIComponent(adminFor.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "pick" ? { userId: pick } : newAdmin),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "保存失败");
    router.refresh();
    if (data.inviteLink) {
      setTemp({ email: newAdmin.email.trim().toLowerCase(), link: data.inviteLink, emailed: Boolean(data.emailed) });
      return;
    }
    toast.success(`已设置「${adminFor.name}」的企业超管`);
    setAdminFor(null);
  }

  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader
          crumbs={[{ label: "企业管理", icon: "network" }]}
          count={rows.length}
          actions={
            <button
              type="button"
              className="btn-primary nv-head-btn"
              onClick={() => {
                setError("");
                setForm({ name: "", code: "" });
              }}
            >
              新建企业
            </button>
          }
        />
      </div>
      <p className="nv-pos-note" role="note">
        <Info size={14} aria-hidden="true" />
        每个企业有唯一的企业超级管理员，由 Weavi Space 系统超管指定；企业超管维护本企业的部门和成员。企业成员用专属登录链接登录。
      </p>
      <div className="list-table-scroll nv-list-scroll">
        <div className="nv-pos-table" role="table" aria-label={`企业列表，共 ${rows.length} 个`}>
          <div className="nv-pos-row nv-nova-row is-head" role="row">
            <span role="columnheader">企业</span>
            <span role="columnheader">企业超管</span>
            <span role="columnheader">成员</span>
            <span role="columnheader">项目</span>
            <span role="columnheader">专属登录链接</span>
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {rows.length === 0 ? <div className="nv-nova-empty">还没有企业，点右上角「新建企业」。</div> : null}
          {rows.map((e) => (
            <div key={e.id} className="nv-pos-row nv-nova-row" role="row">
              <span role="cell" className="nv-pos-name">
                <b>{e.name}</b>
                {e.code ? <code>{e.code}</code> : null}
              </span>
              <span role="cell" className="nv-nova-admin">
                {e.admin ? (
                  <>
                    <b>{e.admin.name}</b>
                    <span aria-hidden="true">·</span>
                    <span className="nv-nova-admin-email">{e.admin.email}</span>
                  </>
                ) : (
                  <span className="nv-tag is-warning">未指定</span>
                )}
              </span>
              <span role="cell">{e.memberCount} 人</span>
              <span role="cell">{e.projectCount}</span>
              <span role="cell" className="nv-nova-link">
                {e.code ? (
                  <button
                    type="button"
                    className="nv-nova-copy"
                    title={loginLink(e.code)}
                    onClick={async () => ((await copyText(loginLink(e.code!))) ? toast.success("已复制登录链接") : toast.error("复制失败，请手动复制"))}
                  >
                    <span>/login?org={e.code}</span>
                    <Copy size={13} aria-hidden="true" />
                    <span className="sr-only">复制 {e.name} 的登录链接</span>
                  </button>
                ) : (
                  <span className="nv-tag is-neutral">未设置编码</span>
                )}
              </span>
              <span role="cell" className="nv-member-more">
                <ActionMenu
                  label={`${e.name} 的更多操作`}
                  items={[
                    { label: e.admin ? "更换企业超管" : "指定企业超管", onSelect: () => void openAdmin(e) },
                    {
                      label: "编辑",
                      onSelect: () => {
                        setError("");
                        setForm({ id: e.id, name: e.name, code: e.code || "" });
                      },
                    },
                  ]}
                />
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? "编辑企业" : "新建企业"}
        dirty={Boolean(form && (editing ? form.name !== editing.name || form.code !== (editing.code || "") : form.name || form.code))}
        busy={busy}
        panelClassName="nv-prod-modal nv-sm-modal"
      >
        {form ? (
          <form onSubmit={submitForm} className="nv-pform" noValidate>
            <p className="nv-pform-intro">企业直属 Weavi Space，数据按企业隔离。建好后再指定企业超管。</p>
            <div className="nv-pform-body">
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-name`}>
                <span className="nv-pfield-label">企业名称</span>
                <input id={`${baseId}-name`} className="input" value={form.name} maxLength={50} placeholder="如：星河科技" data-initial-focus="" onChange={(ev) => setForm({ ...form, name: ev.target.value })} />
              </label>
              <label className="nv-pfield" htmlFor={`${baseId}-code`}>
                <span className="nv-pfield-label">企业编码</span>
                <input
                  id={`${baseId}-code`}
                  className="input"
                  value={form.code}
                  maxLength={32}
                  placeholder="如：xinghe"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby={`${baseId}-code-hint`}
                  onChange={(ev) => setForm({ ...form, code: ev.target.value.toLowerCase() })}
                />
                <span id={`${baseId}-code-hint`} className="nv-pfield-hint">
                  {CODE_HINT}
                </span>
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">{editing?.code && form.code !== editing.code ? "改编码后，旧的登录链接会失效" : ""}</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "保存中…" : form.id ? "保存" : "创建"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(adminFor)}
        onClose={() => setAdminFor(null)}
        title={temp ? "企业超管已创建" : adminFor?.admin ? "更换企业超管" : "指定企业超管"}
        dirty={Boolean(!temp && (mode === "new" ? newAdmin.name || newAdmin.email : pick && pick !== adminFor?.admin?.id))}
        busy={busy}
        panelClassName="nv-prod-modal nv-sm-modal"
      >
        {adminFor && temp ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-pform-intro">{temp.emailed ? "邀请已发到对方邮箱。" : ""}邀请链接只显示这一次，请发给对方：打开后核对邮箱即可登录，首次登录时自己设置密码（7 天内有效）。</p>
              <div className="nv-nova-temp">
                <span>账号</span>
                <code>{temp.email}</code>
                <span>邀请链接</span>
                <code>{temp.link}</code>
              </div>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                onClick={async () => ((await copyText(`账号：${temp.email}\n邀请链接：${temp.link}${adminFor.code ? `\n以后登录：${loginLink(adminFor.code)}` : ""}`)) ? toast.success("已复制") : toast.error("复制失败，请手动复制"))}
              >
                复制
              </button>
              <button type="button" className="btn-primary nv-head-btn" onClick={() => setAdminFor(null)}>
                完成
              </button>
            </div>
          </div>
        ) : adminFor ? (
          <form onSubmit={submitAdmin} className="nv-pform" noValidate>
            <p className="nv-pform-intro">
              「{adminFor.name}」只能有一个企业超管。{adminFor.admin ? `现在是 ${adminFor.admin.name}，更换后对方保留原账号和角色。` : ""}角色低于管理者的会升为管理者。
            </p>
            <div className="nv-pform-body">
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              <div className="nv-nova-mode" role="radiogroup" aria-label="超管来源">
                <label>
                  <input type="radio" name={`${baseId}-mode`} checked={mode === "pick"} disabled={!candidates?.length} onChange={() => setMode("pick")} />
                  选本企业已有账号
                </label>
                <label>
                  <input type="radio" name={`${baseId}-mode`} checked={mode === "new"} onChange={() => setMode("new")} />
                  新建账号
                </label>
              </div>
              {mode === "pick" ? (
                <label className="nv-pfield" htmlFor={`${baseId}-pick`}>
                  <span className="nv-pfield-label">账号</span>
                  <select id={`${baseId}-pick`} className="input" value={pick} disabled={!candidates} onChange={(ev) => setPick(ev.target.value)}>
                    <option value="">{candidates ? "请选择" : "加载中…"}</option>
                    {(candidates || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}（{u.email}）
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="nv-pfield" htmlFor={`${baseId}-aname`}>
                    <span className="nv-pfield-label">姓名</span>
                    <input id={`${baseId}-aname`} className="input" value={newAdmin.name} maxLength={40} onChange={(ev) => setNewAdmin({ ...newAdmin, name: ev.target.value })} />
                  </label>
                  <label className="nv-pfield" htmlFor={`${baseId}-aemail`}>
                    <span className="nv-pfield-label">邮箱（登录账号）</span>
                    <input id={`${baseId}-aemail`} className="input" type="email" value={newAdmin.email} maxLength={100} autoCapitalize="off" onChange={(ev) => setNewAdmin({ ...newAdmin, email: ev.target.value })} />
                  </label>
                </>
              )}
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">{mode === "new" ? "会生成邀请链接，不设密码" : ""}</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "保存中…" : "确定"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
