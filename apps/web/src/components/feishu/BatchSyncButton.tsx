"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Target = "requirement" | "bug";
type Summary = { at: string; auto?: boolean } | null;
type LinkRow = {
  id: string;
  name: string;
  kind: "sheet" | "bitable";
  target: Target;
  projectId: string;
  projectName: string | null;
  productName: string | null;
  autoSync?: "off" | "pull" | "push";
  autoEvery?: number;
  lastPull: Summary;
  lastPush: Summary;
};
type Counts = { create: number; update: number; same: number; skip: number; append: number };
/** 每个连接的预览 / 执行状态 */
type RowState = { state: "idle" | "loading" | "ready" | "running" | "done" | "error"; counts?: Counts; message?: string };

const EVERY: Record<number, string> = { 15: "每 15 分钟", 30: "每 30 分钟", 60: "每小时", 180: "每 3 小时", 720: "每 12 小时", 1440: "每天" };
function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function scopeText(l: LinkRow) {
  const pool = l.target === "bug" ? "公共 Bug" : "公共需求池";
  return l.projectName ? `项目「${l.projectName}」` : l.productName ? `产品「${l.productName}」的${pool}` : pool;
}
function changeText(c: Counts, pull: boolean) {
  const parts = pull ? [c.create && `新增 ${c.create}`, c.update && `更新 ${c.update}`] : [c.update && `更新 ${c.update}`, c.append && `追加 ${c.append}`];
  const s = parts.filter(Boolean).join(" · ");
  return s || "没有变化";
}

/**
 * Figma 65：需求池 / Bug 列表功能区的「飞书同步」——选已配置的表格连接，批量拉取或回写。
 * 只列导入到当前类型（需求池 / Bug）的连接；在项目内只列这个项目的连接。勾选后自动预览，确认后逐个执行。
 */
export function BatchSyncButton({ target, projectId }: { target: Target; projectId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        飞书同步
      </button>
      {open ? <BatchSyncModal target={target} projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BatchSyncModal({ target, projectId, onClose }: { target: Target; projectId?: string; onClose: () => void }) {
  const baseId = useId();
  const router = useRouter();
  const toast = useToast();
  const noun = target === "bug" ? "Bug" : "需求池";
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [error, setError] = useState("");
  const [pull, setPull] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/feishu-tables", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (!ok) return setError(d.error || "读取连接失败");
        const list = ((d.links || []) as LinkRow[]).filter((l) => (l.target || "requirement") === target && (!projectId || l.projectId === projectId));
        setLinks(list);
        // 默认勾选上次同步过的连接
        setPicked(list.filter((l) => l.lastPull || l.lastPush).map((l) => l.id));
      })
      .catch(() => alive && setError("读取连接失败"));
    return () => {
      alive = false;
    };
  }, [target, projectId]);

  const preview = useCallback(
    async (id: string, isPull: boolean) => {
      setRows((r) => ({ ...r, [id]: { state: "loading" } }));
      const res = await fetch(`/api/feishu-tables/${id}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: isPull ? "pull" : "push" }) });
      const d = await res.json().catch(() => ({}));
      setRows((r) => ({ ...r, [id]: res.ok ? { state: "ready", counts: d.counts as Counts } : { state: "error", message: d.error || "预览失败" } }));
    },
    [],
  );

  // 勾选或切换方向后重新预览（执行完后不再自动预览，避免覆盖结果）
  useEffect(() => {
    if (finished) return;
    for (const id of picked) void preview(id, pull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull, picked.join(","), finished]);

  async function runAll() {
    if (running || !picked.length) return;
    setRunning(true);
    let ok = 0;
    let bad = 0;
    for (const id of picked) {
      setRows((r) => ({ ...r, [id]: { ...r[id], state: "running" } }));
      const res = await fetch(`/api/feishu-tables/${id}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: pull ? "pull" : "push", apply: true }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        ok++;
        setRows((r) => ({ ...r, [id]: { state: "done", message: String(d.message || "").split("　")[1] || "完成" } }));
      } else {
        bad++;
        setRows((r) => ({ ...r, [id]: { state: "error", message: d.error || "同步失败" } }));
      }
    }
    setRunning(false);
    setFinished(true);
    router.refresh();
    if (bad) toast.error(`${ok} 个连接已${pull ? "拉取" : "回写"}，${bad} 个失败，见列表`);
    else toast.success(`已${pull ? "从飞书拉取" : "回写飞书"} ${ok} 个连接`);
  }

  const total = picked.reduce(
    (acc, id) => {
      const c = rows[id]?.counts;
      if (c) {
        acc.create += c.create;
        acc.update += c.update;
        acc.append += c.append;
      }
      return acc;
    },
    { create: 0, update: 0, append: 0 },
  );
  const loading = picked.some((id) => rows[id]?.state === "loading");

  return (
    <Modal open onClose={onClose} title={`飞书表格同步 · ${noun}`} busy={running} panelClassName="nv-prod-modal nv-ftab-batch">
      <div className="nv-pform">
        <p className="nv-pform-intro">
          选择已配置的表格连接，批量从飞书拉取或回写飞书。只列出导入到{noun}的连接{projectId ? "（本项目）" : ""}；先预览，确认后逐个执行。
        </p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error">
              {error}
            </div>
          ) : null}
          <div className="nv-ftab-batch-dir">
            <span className="nv-pfield-label" id={`${baseId}-dir`}>
              方向
            </span>
            <div className="nv-pform-seg nv-ftab-seg" role="group" aria-labelledby={`${baseId}-dir`}>
              <button type="button" aria-pressed={pull} disabled={running} onClick={() => (setFinished(false), setPull(true))}>
                从飞书拉取
              </button>
              <button type="button" aria-pressed={!pull} disabled={running} onClick={() => (setFinished(false), setPull(false))}>
                回写飞书
              </button>
            </div>
          </div>
          {!links ? (
            error ? null : <p className="nv-set-hint">正在读取连接…</p>
          ) : links.length === 0 ? (
            <p className="nv-itr-empty">
              还没有导入到{noun}的连接{projectId ? "（本项目）" : ""}。到
              <Link href="/system/feishu-tables">设置 › 飞书表格</Link>
              新建一个。
            </p>
          ) : (
            <ul className="nv-ftab-batch-list" aria-label="表格连接">
              {links.map((l) => {
                const on = picked.includes(l.id);
                const st = rows[l.id];
                const last = pull ? l.lastPull : l.lastPush;
                const auto = l.autoSync && l.autoSync !== "off" ? ` · ${EVERY[l.autoEvery || 60] || "每小时"}自动${l.autoSync === "pull" ? "拉取" : "回写"}` : "";
                return (
                  <li key={l.id}>
                    <label className="nv-ftab-batch-row">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={running}
                        onChange={(e) => {
                          setFinished(false);
                          setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)));
                        }}
                      />
                      <span className="nv-ftab-batch-t">
                        <span className="nv-ftab-batch-name">{l.name}</span>
                        <span className="nv-set-hint">
                          {l.kind === "bitable" ? "多维表格" : "电子表格"} · {scopeText(l)}
                          {auto} · {last ? `上次${pull ? "拉取" : "回写"} ${stamp(last.at)}` : "还没有同步过"}
                        </span>
                      </span>
                      {on && st ? (
                        st.state === "loading" ? (
                          <span className="nv-tag is-neutral">预览中…</span>
                        ) : st.state === "running" ? (
                          <span className="nv-tag is-info">执行中…</span>
                        ) : st.state === "error" ? (
                          <span className="nv-tag is-dot is-danger" title={st.message}>
                            {st.message && st.message.length > 18 ? `${st.message.slice(0, 18)}…` : st.message}
                          </span>
                        ) : st.state === "done" ? (
                          <span className="nv-tag is-dot is-success">{st.message}</span>
                        ) : st.counts ? (
                          <span className={`nv-tag is-dot ${changeText(st.counts, pull) === "没有变化" ? "is-neutral" : "is-info"}`}>{changeText(st.counts, pull)}</span>
                        ) : null
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {links && links.length ? (
            <p className="nv-set-hint" aria-live="polite">
              已选 {picked.length} 个连接
              {picked.length && !loading && !finished
                ? ` · 预览共${pull ? `新增 ${total.create}、更新 ${total.update}` : `更新 ${total.update}、追加 ${total.append}`}`
                : ""}
              ；没有权限或读取失败的连接会跳过并提示。{pull ? "表格里删掉的行不会删除系统里的记录。" : "只写各连接勾选回写的列。"}
            </p>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <Link href="/system/feishu-tables" className="nv-pform-note">
            管理连接 ›
          </Link>
          <ModalCancelButton className="btn-secondary nv-head-btn">{finished ? "关闭" : "取消"}</ModalCancelButton>
          <button type="button" className="btn-primary nv-head-btn" disabled={running || loading || !picked.length || finished} aria-busy={running || undefined} onClick={() => void runAll()}>
            {running ? "执行中…" : finished ? "已完成" : "全部执行"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
