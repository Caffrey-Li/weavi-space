"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { FileText, Plus, RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { stamp } from "./FeishuTablesPanel";

type Link = {
  id: string;
  name: string;
  url: string;
  kind: string;
  spaceId: string;
  spaceName: string;
  parentTitle: string | null;
  autoSync: string;
  importAs: string;
  lastSyncAt: string | null;
  lastResult: string | null;
  pages: number;
  ownerName: string;
  canEdit: boolean;
};
type Space = { id: string; name: string };
const KIND: Record<string, string> = { docx: "文档", wiki: "知识库节点", folder: "文件夹" };
const IMPORT_AS: Record<string, string> = { doc: "只导入文档", requirement: "同时建成需求", bug: "同时建成 Bug" };
const EMPTY = { name: "", url: "", spaceId: "", parentPageId: "", importAs: "doc", autoSync: "off" };

/**
 * 设置 · 云表格 · 云文档：把飞书云文档（单篇文档、知识库节点及其直属子页面、文件夹里的文档）单向导入到指定文档空间的目录下。
 * 再次同步会更新同一页面并发布新版本。T33：可选「同时建成需求 / Bug」（每篇第一次导入时建一条）和每天自动同步。
 */
export function CloudDocsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [pages, setPages] = useState<{ id: string; title: string; depth: number }[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Link | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const r = await fetch("/api/cloud-docs", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || "读取失败");
    else setLinks(d.links);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function openNew() {
    setError("");
    setForm(EMPTY);
    setEditing(null);
    setOpen(true);
    const t = await fetch("/api/docs/spaces", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (!t) return;
    const list: Space[] = [
      ...(t.products || []).filter((p: { spaceId?: string }) => p.spaceId).map((p: { spaceId: string; name: string }) => ({ id: p.spaceId, name: `产品 · ${p.name}` })),
      ...(t.products || []).flatMap((p: { projects: Space[] }) => p.projects),
      ...(t.unassigned || []),
    ];
    setSpaces(list);
  }

  useEffect(() => {
    if (!form.spaceId) return setPages([]);
    let alive = true;
    void fetch(`/api/docs/spaces/${form.spaceId}/tree`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pages?: { id: string; title: string; parentId: string | null }[] } | null) => {
        if (!alive || !d?.pages) return;
        const flat: { id: string; title: string; depth: number }[] = [];
        const walk = (parent: string | null, depth: number) => {
          for (const p of d.pages!.filter((x) => x.parentId === parent)) {
            flat.push({ id: p.id, title: p.title, depth });
            if (depth < 4) walk(p.id, depth + 1);
          }
        };
        walk(null, 0);
        setPages(flat);
      });
    return () => {
      alive = false;
    };
  }, [form.spaceId]);

  function openEdit(l: Link) {
    setError("");
    setEditing(l);
    setForm({ ...EMPTY, name: l.name, url: l.url, spaceId: l.spaceId, importAs: l.importAs || "doc", autoSync: l.autoSync || "off" });
    setSpaces([{ id: l.spaceId, name: l.spaceName }]);
    setOpen(true);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("new");
    setError("");
    const r = editing
      ? await fetch(`/api/cloud-docs/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, importAs: form.importAs, autoSync: form.autoSync }) })
      : await fetch("/api/cloud-docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(d.error || "保存失败");
    setOpen(false);
    toast.success(editing ? "已保存" : "已添加云文档，点「同步」导入");
    void load();
  }

  async function sync(l: Link) {
    setBusy(l.id);
    const r = await fetch(`/api/cloud-docs/${l.id}/sync`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) toast.error(d.error || "同步失败");
    else toast.success(`同步完成：新增 ${d.created} 篇，更新 ${d.updated} 篇${d.requirements ? `，建需求 ${d.requirements} 条` : ""}${d.bugs ? `，建 Bug ${d.bugs} 个` : ""}${d.errors?.length ? `，${d.errors.length} 条提示` : ""}`);
    void load();
  }

  async function remove(l: Link) {
    if (!(await confirm({ title: `删除「${l.name}」？`, body: "只删除同步关系，已导入的文档页面保留。", confirmLabel: "删除", tone: "danger" }))) return;
    const r = await fetch(`/api/cloud-docs/${l.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("已删除");
      void load();
    } else toast.error("删除失败");
  }

  if (!links) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;
  const shown = links.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <header className="nv-ftab-head">
        <div className="nv-set-title">
          <h1>云文档</h1>
          <p>把飞书云文档单向导入到系统的文档空间：可以是一篇文档、一个知识库节点（连同直属子页面）或一个文件夹。再次同步会更新同一页面并发布新版本。</p>
        </div>
        <button type="button" className="btn-primary nv-head-btn" onClick={() => void openNew()}>
          <Plus size={14} aria-hidden="true" />
          添加云文档
        </button>
      </header>
      <Banner title="使用前在飞书开发者后台为应用开通「查看云文档」「查看知识库」「查看云空间文件」「下载云文档中的图片和附件」权限，并把应用加为文档 / 知识库 / 文件夹的协作者。" />
      {links.length === 0 ? <p className="nv-itr-empty">还没有云文档。点「添加云文档」粘贴飞书链接，选择要导入到的空间和目录。</p> : null}
      {shown.map((l) => {
        const r = (() => {
          try {
            return l.lastResult ? (JSON.parse(l.lastResult) as { created?: number; updated?: number; requirements?: number; bugs?: number; errors?: string[]; error?: string; auto?: boolean }) : null;
          } catch {
            return null;
          }
        })();
        return (
          <section key={l.id} className="nv-itr-card" aria-label={l.name}>
            <div className="nv-itr-head">
              <span className="nv-itr-icon" aria-hidden="true">
                <FileText size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="nv-itr-title">
                  <span className="nv-itr-title-text">{l.name}</span>
                  <span className="nv-tag is-neutral">{KIND[l.kind] || l.kind}</span>
                  {l.autoSync === "daily" ? <span className="nv-tag is-neutral">每天自动同步</span> : null}
                  {l.importAs && l.importAs !== "doc" ? <span className="nv-tag is-neutral">{IMPORT_AS[l.importAs]}</span> : null}
                </p>
                <p className="nv-itr-sub">
                  导入到 {l.spaceName}
                  {l.parentTitle ? ` › ${l.parentTitle}` : "（空间根下）"} · 已导入 {l.pages} 篇 · 创建人 {l.ownerName}
                </p>
              </div>
            </div>
            <div className="nv-itr-status">
              <div className="min-w-0 flex-1">
                <p className="nv-itr-status-title">
                  {l.lastSyncAt ? `${r?.auto ? "上次自动同步" : "上次同步"} ${stamp(l.lastSyncAt)} · ${r?.error ? `失败：${r.error}` : `新增 ${r?.created ?? 0}，更新 ${r?.updated ?? 0}${r?.requirements ? `，建需求 ${r.requirements}` : ""}${r?.bugs ? `，建 Bug ${r.bugs}` : ""}${r?.errors?.length ? `，提示 ${r.errors.length} 条` : ""}`}` : r?.error ? `自动同步未执行：${r.error}` : "还没有同步过"}
                </p>
              </div>
              {l.canEdit ? (
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => void sync(l)} disabled={busy === l.id} aria-busy={busy === l.id || undefined}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {busy === l.id ? "同步中…" : "同步"}
                </button>
              ) : null}
              <ActionMenu
                label={`${l.name} 的更多操作`}
                items={[
                  { label: "打开飞书原文", onSelect: () => window.open(l.url, "_blank", "noopener") },
                  { label: "同步设置", disabled: !l.canEdit, onSelect: () => openEdit(l) },
                  { label: "删除", tone: "danger", disabled: !l.canEdit, onSelect: () => void remove(l) },
                ]}
              />
            </div>
          </section>
        );
      })}
      {links.length > pageSize ? <Pagination total={links.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} /> : null}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "同步设置" : "添加云文档"} busy={busy === "new"} dirty={!editing && Boolean(form.url || form.name)} panelClassName="nv-prod-modal nv-sm-modal">
        <form onSubmit={create} className="nv-pform" noValidate>
          <div className="nv-pform-body">
            {error ? (
              <div role="alert" className="banner-error" tabIndex={-1}>
                {error}
              </div>
            ) : null}
            <label className="nv-pfield" htmlFor={`${id}-url`}>
              <span className="nv-pfield-label">飞书链接</span>
              <input id={`${id}-url`} className="input" value={form.url} disabled={Boolean(editing)} placeholder="https://xxx.feishu.cn/docx/… 或 /wiki/… 或 /drive/folder/…" data-initial-focus="" onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </label>
            <label className="nv-pfield" htmlFor={`${id}-name`}>
              <span className="nv-pfield-label">名称</span>
              <input id={`${id}-name`} className="input" value={form.name} maxLength={60} placeholder="如：产品需求文档" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="nv-pfield" htmlFor={`${id}-space`}>
              <span className="nv-pfield-label">导入到空间</span>
              <select id={`${id}-space`} className="input" value={form.spaceId} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, spaceId: e.target.value, parentPageId: "" })}>
                <option value="">请选择</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {editing ? null : (
            <label className="nv-pfield" htmlFor={`${id}-parent`}>
              <span className="nv-pfield-label">目录</span>
              <select id={`${id}-parent`} className="input" value={form.parentPageId} disabled={!form.spaceId} onChange={(e) => setForm({ ...form, parentPageId: e.target.value })}>
                <option value="">空间根下</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {"　".repeat(p.depth)}
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            )}
            <label className="nv-pfield" htmlFor={`${id}-import`}>
              <span className="nv-pfield-label">导入方式</span>
              <select id={`${id}-import`} className="input" value={form.importAs} onChange={(e) => setForm({ ...form, importAs: e.target.value })}>
                {Object.entries(IMPORT_AS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="nv-pfield-hint">建成需求时以导入的页面为主需求文档；建成 Bug 只限项目空间。每篇文档只在第一次导入时建一条，之后同步只更新文档。</span>
            </label>
            <label className="nv-pfield" htmlFor={`${id}-auto`}>
              <span className="nv-pfield-label">自动同步</span>
              <select id={`${id}-auto`} className="input" value={form.autoSync} onChange={(e) => setForm({ ...form, autoSync: e.target.value })}>
                <option value="off">不自动同步</option>
                <option value="daily">每天自动同步一次</option>
              </select>
              <span className="nv-pfield-hint">自动同步以连接创建人的身份和权限执行。</span>
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note">只从飞书导入到系统，不回写</span>
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="submit" className="btn-primary nv-head-btn" disabled={busy === "new" || (!editing && (!form.url || !form.spaceId))}>
              保存
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
