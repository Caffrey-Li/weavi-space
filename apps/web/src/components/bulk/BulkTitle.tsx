"use client";

import { useEffect, useState } from "react";
import { Sparkle } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { TITLE_MAX } from "@/lib/title-gen-shared";

type Kind = "requirement" | "bug";
const NOUN: Record<Kind, string> = { requirement: "条需求", bug: "个 Bug" };

/** 多选后的底部操作条（Figma 07 / 10）：已选 N · 根据描述生成标题 · 删除 · 取消选择 */
export function BulkBar({
  kind,
  count,
  onGenerate,
  onClear,
  onDelete,
  deleting = false,
  actions = [],
}: {
  kind: Kind;
  count: number;
  /** 不传就不显示生成标题（只有删除权限时） */
  onGenerate?: () => void;
  onClear: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  /** 生成标题之前的其他批量操作（需求池：批量设置、移入 Bug） */
  actions?: { label: string; icon: React.ReactNode; onClick: () => void }[];
}) {
  if (!count) return null;
  return (
    <div className="nv-bulk-bar" role="toolbar" aria-label="批量操作">
      <span className="nv-bulk-count">
        已选 <strong>{count}</strong> {NOUN[kind]}
      </span>
      {actions.map((a) => (
        <button key={a.label} type="button" className="btn-secondary nv-head-btn" onClick={a.onClick}>
          {a.icon}
          {a.label}
        </button>
      ))}
      {onGenerate ? (
        <button type="button" className={`${actions.length ? "btn-secondary" : "btn-primary"} nv-head-btn`} onClick={onGenerate}>
          <Sparkle size={14} aria-hidden="true" />
          {actions.length ? "生成标题" : "根据描述生成标题"}
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="btn-ghost nv-head-btn text-nv-danger-fg" disabled={deleting} aria-busy={deleting || undefined} onClick={onDelete}>
          {deleting ? "删除中…" : "删除"}
        </button>
      ) : null}
      <button type="button" className="btn-ghost nv-head-btn" onClick={onClear}>
        取消选择
      </button>
    </div>
  );
}

type Row = { id: string; code: string; title: string; next: string; reason?: string };

/** 批量生成标题预览（Figma 46）：原标题 → 新标题（可改），勾选的才写入 */
export function BulkTitleModal({
  kind,
  ids,
  onClose,
  onDone,
}: {
  kind: Kind;
  ids: string[];
  onClose: () => void;
  onDone: (updated: { id: string; title: string }[], denied: string[]) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<"ai" | "rules">("rules");
  const [truncated, setTruncated] = useState(false);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/title-gen/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ids }) }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!alive) return;
      if (!res?.ok) return setError((d as { error?: string }).error || "生成失败，请重试");
      const list = (d as { items: Row[] }).items || [];
      setRows(list);
      setSource((d as { source?: "ai" | "rules" }).source || "rules");
      setTruncated(Boolean((d as { truncated?: boolean }).truncated));
      setOn(new Set(list.filter((r) => !r.reason).map((r) => r.id)));
      setEdits(Object.fromEntries(list.map((r) => [r.id, r.next])));
    })();
    return () => {
      alive = false;
    };
  }, [kind, ids]);

  const usable = (rows || []).filter((r) => !r.reason);
  const picked = usable.filter((r) => on.has(r.id) && (edits[r.id] || "").trim() && edits[r.id].trim() !== r.title);

  async function apply() {
    if (!picked.length || busy) return;
    setBusy(true);
    setError("");
    const items = picked.map((r) => ({ id: r.id, title: edits[r.id].trim() }));
    const res = await fetch("/api/title-gen/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, items }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error || "更新失败，请重试");
    const denied = (d as { denied?: string[] }).denied || [];
    onDone(items.filter((x) => !denied.includes(rows!.find((r) => r.id === x.id)!.code)), denied);
  }

  const noun = NOUN[kind];
  return (
    <Modal open onClose={onClose} title={`根据描述生成标题 · 已选 ${ids.length} ${noun}`} busy={busy} panelClassName="nv-prod-modal nv-ftab-preview">
      <div className="nv-pform">
        <p className="nv-pform-intro">按每{noun}{kind === "bug" ? " " : ""}的描述提炼核心内容，生成 {TITLE_MAX} 字以内的标题。可以先改写再确认；没勾选的保持原标题。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          {!rows && !error ? <p className="nv-set-hint">正在读取描述并生成标题…</p> : null}
          {rows ? (
            <>
              <div className="nv-ftab-chips">
                <span className="nv-tag is-dot is-success">可更新 {usable.length}</span>
                {rows.length - usable.length ? <span className="nv-tag is-dot is-neutral">跳过 {rows.length - usable.length}</span> : null}
              </div>
              {truncated ? <p className="nv-set-hint">一次最多处理 100 条，只列出了前 100 条</p> : null}
              <ul className="nv-btitle-list">
                {rows.map((r) => (
                  <li key={r.id}>
                    <div className="nv-btitle-head">
                      <input
                        type="checkbox"
                        aria-label={`更新 ${r.code} 的标题`}
                        checked={!r.reason && on.has(r.id)}
                        disabled={Boolean(r.reason)}
                        onChange={(e) =>
                          setOn((prev) => {
                            const s = new Set(prev);
                            if (e.target.checked) s.add(r.id);
                            else s.delete(r.id);
                            return s;
                          })
                        }
                      />
                      <span className="nv-btitle-code">{r.code}</span>
                      <span className={`nv-btitle-old${r.reason ? "" : " is-replaced"}`} title={r.title}>
                        {r.title}
                      </span>
                      {r.reason ? <span className="nv-tag is-dot is-neutral">{r.reason}</span> : null}
                    </div>
                    {!r.reason ? (
                      <div className="nv-btitle-new">
                        <span aria-hidden="true">→</span>
                        <input
                          className="input"
                          value={edits[r.id] ?? ""}
                          maxLength={200}
                          aria-label={`${r.code} 的新标题`}
                          disabled={!on.has(r.id)}
                          onChange={(e) => setEdits((p) => ({ ...p, [r.id]: e.target.value }))}
                        />
                        <span className={`nv-btitle-count${Array.from(edits[r.id] || "").length > TITLE_MAX ? " is-over" : ""}`}>
                          {Array.from(edits[r.id] || "").length}/{TITLE_MAX}
                        </span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="nv-set-hint">{source === "ai" ? "生成方式：Claude 根据描述提炼" : "生成方式：按描述规则提炼（未配置大模型）；配置 Claude 后改为 AI 提炼"}</p>
            </>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">每条标题修改都会记入{kind === "bug" ? " Bug " : "需求"}动态</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="button" className="btn-primary nv-head-btn" disabled={!picked.length || busy} aria-busy={busy || undefined} onClick={() => void apply()}>
            {busy ? "更新中…" : picked.length ? `更新 ${picked.length} 条标题` : "没有需要更新的标题"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
