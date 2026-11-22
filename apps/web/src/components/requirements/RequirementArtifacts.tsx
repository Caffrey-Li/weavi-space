"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import {
  ARTIFACT_KINDS,
  ARTIFACT_LABEL,
  COMPLETENESS_KINDS,
  REQUIRED_KINDS,
  type ArtifactItem,
  type ArtifactKind,
  type Completeness,
  cleanArtifactUrl,
  titleFromUrl,
} from "@pm-collab/core/shared/artifacts-shared";

export type ArtifactListData = { items: ArtifactItem[]; completeness: Completeness; canEdit: boolean };

type Source = "link" | "file" | "doc";
type DocRow = { id: string; title: string; spaceId: string; spaceName: string; type?: string };

const SHORT: Record<string, string> = { ui: "UI", prototype: "原型", doc: "文档", testcases: "用例", report: "报告" };

/** 需求资料（T42，Figma 88A / 88B）：UI 设计 / 原型 / 需求文档 / 测试用例 / 测试报告 / 其他 */
export function RequirementArtifacts({ id, data, childCount, docManager }: { id: string; data: ArtifactListData; childCount: number; docManager?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const { items, completeness, canEdit } = data;

  const remove = async (a: ArtifactItem) => {
    if (!(await confirm({ title: `移除「${a.title}」？`, body: a.source === "file" ? "上传的文件会一起删除。" : "只是从资料里移除，原地址 / 原文档不受影响。", confirmLabel: "移除", tone: "danger" }))) return;
    const r = await fetch(`/api/requirements/${id}/artifacts/${a.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "移除失败");
    toast.success("已移除");
    router.refresh();
  };

  return (
    <section className="nv-art" id="rq-artifacts" aria-labelledby="rq-art-title">
      <div className="nv-ra-head">
        <h2 id="rq-art-title">
          资料<span className="nv-count">{items.length}</span>
        </h2>
        <span className="nv-ra-ready" aria-label="资料齐全度">
          {COMPLETENESS_KINDS.map((k) => {
            const ok = completeness[k as keyof Completeness];
            const req = REQUIRED_KINDS.includes(k);
            return (
              <span key={k} className="nv-ra-ready-item" data-state={ok ? "ok" : req ? "missing" : "optional"} title={ok ? `已有${ARTIFACT_LABEL[k]}` : req ? `缺${ARTIFACT_LABEL[k]}` : `没有${ARTIFACT_LABEL[k]}（不是每条需求都需要）`}>
                {SHORT[k]}
                {ok ? <Check size={11} aria-hidden="true" /> : req ? " 缺" : " —"}
              </span>
            );
          })}
        </span>
        <span className="nv-ra-spacer" />
        {docManager}
        {canEdit ? (
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            添加资料
          </button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="nv-ra-list">
          {items.map((a) => (
            <li key={a.id}>
              <span className="nv-ra-kind" data-kind={a.kind}>
                {ARTIFACT_LABEL[a.kind]}
              </span>
              {a.href.startsWith("http") ? (
                <a className="nv-ra-title" href={a.href} target="_blank" rel="noopener noreferrer">
                  {a.title}
                </a>
              ) : (
                <Link className="nv-ra-title" href={a.href}>
                  {a.title}
                </Link>
              )}
              {a.badge ? <span className={`nv-dl-tag${a.badge.tone === "success" ? " tone-success" : a.badge.tone === "danger" ? " tone-danger" : a.badge.tone === "warning" ? " tone-warn" : ""}`}>{a.badge.label}</span> : null}
              {a.inherited ? <span className="nv-dl-tag">来自父需求</span> : null}
              <span className="nv-ra-meta">{a.meta}</span>
              {a.preview ? (
                <Link className="text-link nv-ra-act" href={a.href}>
                  预览
                </Link>
              ) : null}
              {canEdit && a.removable ? (
                <button type="button" className="nv-ra-remove" aria-label={`移除 ${a.title}`} title="移除" onClick={() => void remove(a)}>
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nv-ra-empty">还没有资料。可以挂 UI 设计稿、原型、需求文档、测试用例和测试报告的线上地址或文件，一直带到发版。</p>
      )}
      {childCount ? <p className="nv-ra-note">勾选「同时显示在子需求里」的资料，{childCount} 条子需求里也能看到（标「来自父需求」）。</p> : null}
      {open ? <AddArtifactModal id={id} childCount={childCount} onClose={() => setOpen(false)} onDone={() => (setOpen(false), router.refresh())} /> : null}
    </section>
  );
}

function AddArtifactModal({ id, childCount, onClose, onDone }: { id: string; childCount: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<ArtifactKind>("ui");
  const [source, setSource] = useState<Source>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [docId, setDocId] = useState("");
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => (docs || []).filter((r) => !q || r.title.includes(q) || r.spaceName.includes(q)).slice(0, 50), [docs, q]);

  const pickSource = (s: Source) => {
    setSource(s);
    if (s === "doc" && docs === null)
      fetch("/api/docs/list")
        .then((r) => r.json())
        .then((d: { rows?: DocRow[] }) => setDocs((d.rows || []).filter((x) => x.type !== "board")))
        .catch(() => setDocs([]));
  };
  const onUrl = (v: string) => {
    setUrl(v);
    const ok = cleanArtifactUrl(v);
    if (ok && !titleTouched) setTitle(titleFromUrl(ok));
  };
  const accept = kind === "prototype" ? ".html,.htm,image/*,.pdf,.zip" : "image/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.html,.htm";
  const valid = source === "link" ? !!cleanArtifactUrl(url) : source === "file" ? !!file : !!docId;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      let r: Response;
      if (source === "file" && file) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", kind);
        fd.set("title", title);
        fd.set("note", note);
        fd.set("shareToChildren", String(share));
        r = await fetch(`/api/requirements/${id}/artifacts`, { method: "POST", body: fd });
      } else {
        r = await fetch(`/api/requirements/${id}/artifacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, source, url, docPageId: docId, title, note, shareToChildren: share }),
        });
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "添加失败");
      toast.success(`已添加${ARTIFACT_LABEL[kind]}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="添加资料" busy={busy} dirty={!!(url || file || docId || note)}>
      <div className="nv-ra-form">
        <div className="nv-ra-field">
          <span className="nv-ra-label" id="art-kind">
            类型
          </span>
          <div className="nv-ra-seg" role="radiogroup" aria-labelledby="art-kind">
            {ARTIFACT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
                {ARTIFACT_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="nv-ra-field">
          <span className="nv-ra-label" id="art-src">
            方式
          </span>
          <div className="nv-ra-seg" role="radiogroup" aria-labelledby="art-src">
            {(
              [
                ["link", "线上地址"],
                ["file", "上传文件"],
                ["doc", "关联系统里的文档"],
              ] as [Source, string][]
            ).map(([s, l]) => (
              <button key={s} type="button" role="radio" aria-checked={source === s} className={source === s ? "is-on" : ""} onClick={() => pickSource(s)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {source === "link" ? (
          <label className="nv-ra-field">
            <span className="nv-ra-label">地址</span>
            <input className="input" value={url} placeholder="https://www.figma.com/design/…" onChange={(e) => onUrl(e.target.value)} autoFocus />
            <span className="nv-ra-hint">支持 Figma、MasterGo、即时设计、墨刀、蓝湖等；Figma 地址可以在需求里直接预览</span>
          </label>
        ) : null}
        {source === "file" ? (
          <div className="nv-ra-field">
            <span className="nv-ra-label">文件</span>
            <div className="nv-ra-file">
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => fileRef.current?.click()}>
                选择文件
              </button>
              <span>{file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : "没有选择文件"}</span>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept={accept}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  if (f && !titleTouched) setTitle(f.name.slice(0, 120));
                }}
              />
            </div>
          </div>
        ) : null}
        {source === "doc" ? (
          <div className="nv-ra-field">
            <span className="nv-ra-label">文档</span>
            <input className="input" value={q} placeholder="搜索文档标题或空间" aria-label="搜索文档" onChange={(e) => setQ(e.target.value)} />
            <ul className="nv-flow-picklist">
              {docs === null ? <li className="nv-flow-meta">正在加载…</li> : null}
              {docs && !shown.length ? <li className="nv-flow-meta">没有找到文档</li> : null}
              {shown.map((d) => (
                <li key={d.id}>
                  <button type="button" aria-pressed={docId === d.id} className={docId === d.id ? "is-on" : ""} onClick={() => (setDocId(d.id), !titleTouched && setTitle(d.title))}>
                    <span>{d.title}</span>
                    <small>{d.spaceName}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className="nv-ra-field">
          <span className="nv-ra-label">标题</span>
          <input className="input" value={title} maxLength={120} placeholder={source === "link" ? "默认取链接里的文件名" : "默认用文件名"} onChange={(e) => (setTitle(e.target.value), setTitleTouched(true))} />
        </label>
        <label className="nv-ra-field">
          <span className="nv-ra-label">版本说明（选填）</span>
          <input className="input" value={note} maxLength={40} placeholder="如 v2 终稿" onChange={(e) => setNote(e.target.value)} />
        </label>
        {childCount ? (
          <label className="nv-ra-check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            同时显示在子需求里（{childCount} 条）
          </label>
        ) : null}
        <p className="nv-ra-tip">上传文件：原型支持单个 HTML，只在沙箱里打开，读不到登录信息、调不了系统接口；其他资料支持图片、PDF、Office、ZIP、文本。单个文件不超过 5 MB。</p>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? "正在添加…" : "添加"}
        </button>
      </div>
    </Modal>
  );
}
