"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { PROJECT_RESOURCE_PRESETS } from "@/lib/constants";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

export type ProjectResourceRow = {
  id: string;
  name: string;
  url: string;
  sortOrder: number;
};

const CUSTOM = "__custom__";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ProjectResources({
  projectId,
  resources,
  canEdit,
  title = "项目资料",
  docsHref,
  addLabel = "添加资料",
}: {
  addLabel?: string;
  /** 「在文档中查看」入口（项目概览里有） */
  docsHref?: string;
  projectId: string;
  resources: ProjectResourceRow[];
  canEdit: boolean;
  /** 文档空间首页里叫「快捷链接」 */
  title?: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectResourceRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<string>(PROJECT_RESOURCE_PRESETS[0]);
  const [customName, setCustomName] = useState("");
  const [url, setUrl] = useState("");

  const sorted = useMemo(
    () => [...resources].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh")),
    [resources],
  );

  function resetForm(row?: ProjectResourceRow | null) {
    setError("");
    if (row) {
      setEditing(row);
      const known = PROJECT_RESOURCE_PRESETS.includes(row.name as (typeof PROJECT_RESOURCE_PRESETS)[number]);
      setPreset(known ? row.name : CUSTOM);
      setCustomName(known ? "" : row.name);
      setUrl(row.url);
    } else {
      setEditing(null);
      setPreset(PROJECT_RESOURCE_PRESETS[0]);
      setCustomName("");
      setUrl("");
    }
  }

  function openCreate() {
    resetForm(null);
    setOpen(true);
  }

  function openEdit(row: ProjectResourceRow) {
    resetForm(row);
    setOpen(true);
  }

  function resolvedName() {
    if (preset === CUSTOM) return customName.trim();
    return preset.trim();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = resolvedName();
    if (!name) {
      setError("请填写资料名称");
      return;
    }
    if (!url.trim()) {
      setError("请填写链接地址");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = editing
        ? await fetch(`/api/projects/${projectId}/resources/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, url: url.trim() }),
          })
        : await fetch(`/api/projects/${projectId}/resources`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, url: url.trim() }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "保存失败");
        setSaving(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("保存失败");
    }
    setSaving(false);
  }

  async function remove(row: ProjectResourceRow) {
    const ok = await confirm({
      title: `删除资料链接「${row.name}」？`,
      body: "只移除本项目里的这条链接记录，不会删除外部文档本身。",
      confirmLabel: "删除链接",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/resources/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "删除失败");
        return;
      }
      toast.success(`已删除链接「${row.name}」`);
      router.refresh();
    } catch {
      toast.error("网络异常，结果未确认，请刷新后核对");
    }
  }

  return (
    <section className="page-section" aria-labelledby="res-title">
      <div className="section-head">
        <h2 id="res-title" className="section-title">
          {title}
          {sorted.length ? <span className="section-count">{sorted.length}</span> : null}
        </h2>
        <span className="section-actions">
          {canEdit && (
            <button type="button" className="btn-ghost nv-section-ghost" onClick={openCreate}>
              <Plus size={14} aria-hidden="true" />
              {addLabel}
            </button>
          )}
          {docsHref ? (
            <a href={docsHref} className="btn-ghost nv-section-ghost">
              在文档中查看
            </a>
          ) : null}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-inline">暂无资料链接。可添加需求文档、产品原型、UI 设计等外链。</p>
      ) : (
        <ul className="resource-grid">
          {sorted.map((r) => (
            <li key={r.id} className="resource-item">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="doc-link-card" title={r.url}>
                <Link2 size={20} aria-hidden="true" className="doc-link-icon" />
                <span className="min-w-0 flex-1">
                  <span className="doc-link-title">{r.name}</span>
                  <span className="doc-link-meta">{hostOf(r.url)}</span>
                </span>
                <ExternalLink size={14} aria-hidden="true" className="resource-open" />
              </a>
              {canEdit && (
                <span className="resource-actions">
                  <button type="button" className="icon-button" aria-label={`编辑资料「${r.name}」`} onClick={() => openEdit(r)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`删除资料「${r.name}」`} onClick={() => void remove(r)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "编辑资料" : "添加资料"} dirty={!!(url || customName || (preset === CUSTOM))} busy={saving}>
        <form onSubmit={submit} className="space-y-3">
          {error ? <div role="alert" className="banner-error" tabIndex={-1}>{error}</div> : null}
          <Field id={`${baseId}-type`} label="资料类型" required>
            <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PROJECT_RESOURCE_PRESETS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value={CUSTOM}>自定义…</option>
            </select>
          </Field>
          {preset === CUSTOM ? (
            <Field id={`${baseId}-custom`} label="自定义名称" required>
              <input className="input" required placeholder="例如：技术方案、接口文档" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            </Field>
          ) : null}
          <Field id={`${baseId}-url`} label="链接地址" required hint="只保存链接记录，不会上传或删除外部文件。支持 http / https。">
            <input className="input" required type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
