"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { fmtDate } from "@/lib/utils";

type Link = { id: string; label: string; expiresAt: string | null; revoked: boolean; expired: boolean; viewCount: number; lastViewedAt: string | null; createdAt: string };

const DAYS = [
  { v: 7, label: "7 天" },
  { v: 30, label: "30 天" },
  { v: 90, label: "90 天" },
  { v: 0, label: "不过期" },
];

/**
 * 项目概览「分享」：生成只读分享链接（不用登录就能看项目进度），可设有效期、随时作废。
 * 链接只在生成时完整显示一次（库里只存哈希）。
 */
export function ShareProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/share-links`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setLinks(r.ok ? d.links : []);
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    const r = await fetch(`/api/projects/${projectId}/share-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, days }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "生成失败");
    const url = `${window.location.origin}/share/${d.token}`;
    setFresh(url);
    setLabel("");
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    toast.success("已生成并复制链接");
    void load();
  }

  async function revoke(l: Link) {
    if (!(await confirm({ title: "作废这个分享链接？", body: "作废后拿到链接的人立即打不开，不能恢复。", confirmLabel: "作废", tone: "danger" }))) return;
    const r = await fetch(`/api/projects/${projectId}/share-links/${l.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "作废失败");
    toast.success("已作废");
    void load();
  }

  const state = (l: Link) => (l.revoked ? "已作废" : l.expired ? "已过期" : l.expiresAt ? `${fmtDate(l.expiresAt)} 到期` : "不过期");

  return (
    <>
      <button type="button" className="btn-secondary nv-section-btn" onClick={() => setOpen(true)}>
        <Link2 size={14} aria-hidden="true" />
        分享
      </button>
      <Modal open={open} onClose={() => { setOpen(false); setFresh(""); }} title={`分享「${projectName}」`} busy={busy}>
        <div className="nv-share">
          <p className="nv-share-intro">生成一个只读链接，对方不用登录就能看项目进度、需求状态和发版计划；不会显示人名、需求描述和 Bug。</p>
          <div className="nv-set-grid">
            <label className="nv-set-field" htmlFor={`${id}-label`}>
              备注（选填）
              <input id={`${id}-label`} className="input" maxLength={60} value={label} placeholder="例如：给客户的周进度" onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="nv-set-field" htmlFor={`${id}-days`}>
              有效期
              <select id={`${id}-days`} className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {DAYS.map((d) => (
                  <option key={d.v} value={d.v}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fresh ? (
            <div className="nv-share-fresh" role="status">
              <span>新链接（只显示这一次，已复制）</span>
              <div>
                <code>{fresh}</code>
                <button type="button" className="icon-button" aria-label="复制链接" title="复制" onClick={() => { void navigator.clipboard?.writeText(fresh); toast.success("已复制"); }}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ) : null}
          <div className="nv-share-list">
            <p className="nv-share-list-head">已生成的链接</p>
            {links === null ? (
              <p className="nv-share-empty">正在读取…</p>
            ) : links.length === 0 ? (
              <p className="nv-share-empty">还没有分享链接。</p>
            ) : (
              <ul>
                {links.map((l) => (
                  <li key={l.id} className={l.revoked || l.expired ? "is-off" : ""}>
                    <div className="min-w-0">
                      <b>{l.label || "未备注"}</b>
                      <p>
                        {fmtDate(l.createdAt)} 生成 · {state(l)} · 打开 {l.viewCount} 次
                      </p>
                    </div>
                    {!l.revoked && !l.expired ? (
                      <button type="button" className="btn-ghost nv-head-btn" onClick={() => void revoke(l)}>
                        作废
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note" />
          <ModalCancelButton className="btn-secondary nv-head-btn">关闭</ModalCancelButton>
          <button type="button" className="btn-primary nv-head-btn" onClick={() => void create()} disabled={busy}>
            {busy ? "生成中…" : "生成链接"}
          </button>
        </div>
      </Modal>
    </>
  );
}
