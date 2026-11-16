"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

export type PositionAdminRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  memberCount: number;
};

/**
 * 岗位管理（Figma 32）：岗位 = 人在项目 / 产品中的职责（产品经理、前端…），只用于选负责人和展示，不决定权限。
 * 内置岗位可改名和说明，不能删；自定义岗位没人使用时可删。
 */
export function PositionAdmin({ positions: initial, canEdit }: { positions: PositionAdminRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [form, setForm] = useState<null | { id?: string; name: string; description: string }>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editing = form?.id ? rows.find((r) => r.id === form.id) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    if (!form.name.trim()) {
      setError("请填写岗位名称");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/positions", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form.id ? { id: form.id, name: form.name, description: form.description } : { name: form.name, description: form.description }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "保存失败");
      return;
    }
    toast.success(form.id ? "已更新岗位" : `已新建岗位「${form.name.trim()}」`);
    setForm(null);
    router.refresh();
  }

  async function remove(p: PositionAdminRow) {
    const ok = await confirm({ title: `删除岗位「${p.name}」？`, body: "删除后不能恢复。", confirmLabel: "删除", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/positions?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== p.id));
    toast.success(`已删除岗位「${p.name}」`);
    router.refresh();
  }

  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader
          crumbs={[{ label: "岗位管理", icon: "briefcase" }]}
          count={rows.length}
          actions={
            canEdit ? (
              <button
                type="button"
                className="btn-primary nv-head-btn"
                onClick={() => {
                  setError("");
                  setForm({ name: "", description: "" });
                }}
              >
                新建岗位
              </button>
            ) : null
          }
        />
      </div>
      <p className="nv-pos-note" role="note">
        <Info size={14} aria-hidden="true" />
        岗位表示人在项目和产品中的职责，用于挑选负责人和展示，不决定权限；权限在「角色权限」中按角色配置。
      </p>
      <div className="list-table-scroll nv-list-scroll">
        <div className="nv-pos-table" role="table" aria-label={`岗位列表，共 ${rows.length} 个`}>
          <div className="nv-pos-row is-head" role="row">
            <span role="columnheader">岗位</span>
            <span role="columnheader">说明</span>
            <span role="columnheader">默认岗位人数</span>
            <span role="columnheader">项目中任职</span>
            <span role="columnheader">类型</span>
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {rows.map((p) => (
            <div key={p.id} className="nv-pos-row" role="row">
              <span role="cell" className="nv-pos-name">
                <b>{p.name}</b>
                <code>{p.key}</code>
              </span>
              <span role="cell" className="nv-pos-desc" title={p.description || undefined}>
                {p.description || "—"}
              </span>
              <span role="cell">{p.userCount} 人</span>
              <span role="cell">{p.memberCount}</span>
              <span role="cell">
                <span className={`nv-tag ${p.isSystem ? "is-neutral" : "is-info"}`}>{p.isSystem ? "内置" : "自定义"}</span>
              </span>
              <span role="cell" className="nv-member-more">
                {canEdit ? (
                  <ActionMenu
                    label={`${p.name} 的更多操作`}
                    items={[
                      {
                        label: "编辑",
                        onSelect: () => {
                          setError("");
                          setForm({ id: p.id, name: p.name, description: p.description || "" });
                        },
                      },
                      { label: "删除", tone: "danger", disabled: p.isSystem, onSelect: () => void remove(p) },
                    ]}
                  />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? "编辑岗位" : "新建岗位"}
        dirty={Boolean(form && (editing ? form.name !== editing.name || form.description !== (editing.description || "") : form.name || form.description))}
        busy={busy}
        panelClassName="nv-prod-modal nv-sm-modal"
      >
        {form ? (
          <form onSubmit={submit} className="nv-pform" noValidate>
            <p className="nv-pform-intro">岗位用于挑选需求、Bug 负责人和展示团队构成，不影响权限。</p>
            <div className="nv-pform-body">
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-pname`}>
                <span className="nv-pfield-label">岗位名称</span>
                <input
                  id={`${baseId}-pname`}
                  className="input"
                  value={form.name}
                  maxLength={30}
                  placeholder="如：UI 设计"
                  data-initial-focus=""
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="nv-pfield" htmlFor={`${baseId}-pdesc`}>
                <span className="nv-pfield-label">说明</span>
                <input
                  id={`${baseId}-pdesc`}
                  className="input"
                  value={form.description}
                  maxLength={100}
                  placeholder="选填，一句话说明职责"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">{editing?.isSystem ? "内置岗位可以改名，不能删除" : ""}</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "保存中…" : form.id ? "保存" : "创建"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
