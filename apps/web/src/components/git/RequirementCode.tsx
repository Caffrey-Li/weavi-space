"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, GitBranch } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Link = { kind: string; ref: string; title: string; url: string; author: string | null; state: string | null; sourceBranch: string | null; targetBranch: string | null; at: string; tasks: string[]; mentions?: string[]; pending?: boolean; repo: string };
export type RequirementCodeData = { repos: { id: string; path: string; webUrl: string; defaultBranch: string; allowWrite: boolean }[]; links: Link[]; branchName: string; canBranch: boolean };

const KIND: Record<string, string> = { mr: "MR", branch: "分支", commit: "提交", tag: "标签" };
const STATE: Record<string, { label: string; tone: string }> = { merged: { label: "已合并", tone: " tone-success" }, opened: { label: "待合并", tone: " tone-info" }, draft: { label: "草稿", tone: "" }, closed: { label: "已关闭", tone: "" } };
const md = (iso: string) => `${new Date(iso).getMonth() + 1}-${String(new Date(iso).getDate()).padStart(2, "0")}`;

/** 需求详情 · 代码（T44，Figma 90C）：关联的 MR / 分支 / 提交，建分支、复制分支名 */
export function RequirementCode({ id, data, tasks }: { id: string; data: RequirementCodeData; tasks: { id: string; code: string; title: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [repoId, setRepoId] = useState(data.repos.find((r) => r.allowWrite)?.id || "");
  const [taskId, setTaskId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data.repos.length && !data.links.length) return null;
  const mrs = data.links.filter((l) => l.kind === "mr").length;
  const branches = data.links.filter((l) => l.kind === "branch").length;
  const commits = data.links.filter((l) => l.kind === "commit").length;
  const order = { mr: 0, branch: 1, commit: 2, tag: 3 } as Record<string, number>;
  const rows = [...data.links].sort((a, b) => order[a.kind] - order[b.kind] || b.at.localeCompare(a.at)).slice(0, 30);

  const copy = async () => {
    await navigator.clipboard?.writeText(data.branchName).catch(() => undefined);
    toast.success(`已复制分支名 ${data.branchName}`);
  };
  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/requirements/${id}/git`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoId, taskId: taskId || null, name: name.trim() || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "建分支失败");
      toast.success(`已建分支 ${d.name}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nv-plan" aria-labelledby="rq-code-title" id="rq-code">
      <div className="nv-ra-head">
        <h2 id="rq-code-title">代码</h2>
        <span className="nv-flow-meta">
          {data.repos.map((r) => r.path).join("、")}
          {data.links.length ? ` · ${mrs} 个 MR · ${branches} 个分支 · ${commits} 次提交` : ""}
        </span>
        <span className="nv-ra-spacer" />
        <button type="button" className="btn-secondary nv-head-btn" onClick={() => void copy()} title="分支名里带上编号，推送后会自动关联">
          <Copy size={14} aria-hidden="true" />
          复制分支名 {data.branchName}
        </button>
        {data.canBranch ? (
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(true)}>
            <GitBranch size={14} aria-hidden="true" />
            建分支
          </button>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="nv-code-list">
          {rows.map((l) => (
            <li key={`${l.repo}:${l.kind}:${l.ref}`}>
              <span className="nv-dl-tag">{KIND[l.kind] || l.kind}</span>
              <span className="nv-code-ref">{l.kind === "mr" ? `!${l.ref}` : l.kind === "commit" ? l.ref.slice(0, 8) : l.ref}</span>
              <a className="nv-code-title" href={l.url} target="_blank" rel="noopener noreferrer" title={l.title}>
                {l.kind === "branch" ? (l.tasks.length ? `关联 ${l.tasks.join("、")}` : "") : l.title}
              </a>
              <span className="nv-ra-spacer" />
              <span className="nv-flow-meta">
                {l.kind === "mr" && l.sourceBranch ? `${l.sourceBranch} → ${l.targetBranch} · ` : ""}
                {l.author ? `${l.author} · ` : ""}
                {md(l.at)}
                {l.kind === "mr" && l.tasks.length ? ` · 合并后完成 ${l.tasks.join("、")}` : l.kind === "commit" && l.tasks.length ? ` · ${l.tasks.join("、")}` : ""}
                {l.mentions?.length ? ` · 只提到 ${l.mentions.join("、")}` : ""}
              </span>
              {l.kind === "mr" && l.state ? <span className={`nv-dl-tag${l.pending ? " tone-warn" : STATE[l.state]?.tone || ""}`}>{l.pending ? "已合并 · 等流水线" : STATE[l.state]?.label || l.state}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nv-ra-empty">还没有关联的代码。在分支名、提交说明或 MR 标题里写上 {data.branchName.split("/")[1]?.split("-")[0]}（或任务编号），推送后会出现在这里。</p>
      )}
      <p className="nv-ra-note">提交只会把任务推到「进行中」；合并进主分支的 MR 才算完成，而且只算从这个任务建的分支，或 MR 里写了「Closes T1234」「完成 T1234」的编号，只是提到的不改状态。合并提交、Revert、草稿 MR 不推状态。</p>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="建分支" busy={busy}>
          <div className="nv-ra-form">
            <label className="nv-ra-field">
              <span className="nv-ra-label">仓库</span>
              <select className="input" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
                {data.repos
                  .filter((r) => r.allowWrite)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.path}（从 {r.defaultBranch} 拉出）
                    </option>
                  ))}
              </select>
            </label>
            <label className="nv-ra-field">
              <span className="nv-ra-label">对应任务（选填）</span>
              <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">整条需求</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="nv-ra-field">
              <span className="nv-ra-label">分支名（选填）</span>
              <input className="input" value={name} placeholder={data.branchName} onChange={(e) => setName(e.target.value)} />
              <span className="nv-ra-hint">留空按编号自动起名；自己起名时记得带上编号，后面的提交才能自动关联。</span>
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={busy || !repoId} onClick={() => void create()}>
              {busy ? "正在创建…" : "建分支"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
