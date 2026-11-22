"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ReqStatusText } from "@/components/ui/ReqStatusText";
import { reqStatusLabel } from "@/lib/constants";

type Refs = { repos: { id: string; path: string; defaultBranch: string }[]; repoId?: string; tags: string[]; branches: string[]; error?: string };
type Row = { id: string; code: string; title: string; status: string; commits: number; mrs: string[]; verdict: "ship" | "notInRelease" | "noCode" };
type Result = { commits: number; unlinked: number; rows: Row[]; canManage: boolean };

const VERDICT = { ship: { label: "会上线", tone: " tone-success" }, notInRelease: { label: "不在发版里", tone: " tone-warn" }, noCode: { label: "还没合并代码", tone: " tone-danger" } };

/** 发版详情 · 代码对比（T44，Figma 90D）：两个标签 / 分支之间的提交 → 会上线的需求；和发版内容对不上的标出来 */
export function ReleaseCodeCompare({ releaseId, version, editable }: { releaseId: string; version: string; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [refs, setRefs] = useState<Refs | null>(null);
  const [repoId, setRepoId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRefs = async (rid?: string) => {
    const r = await fetch(`/api/releases/${releaseId}/git${rid ? `?repoId=${rid}` : ""}`).catch(() => null);
    const d = (r ? await r.json().catch(() => null) : null) as Refs | null;
    if (!d) return;
    setRefs(d);
    setRepoId(d.repoId || "");
    const repo = d.repos.find((x) => x.id === d.repoId);
    setFrom((f) => f || d.tags[0] || "");
    setTo((t) => t || d.branches.find((b) => b.includes(version)) || repo?.defaultBranch || d.branches[0] || "");
  };
  useEffect(() => {
    void loadRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!refs || !refs.repos.length) return null;

  const compare = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/releases/${releaseId}/git`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare", repoId, from, to }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "对比失败");
      setRes(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const missing = res?.rows.filter((r) => r.verdict === "notInRelease") || [];
  const add = async () => {
    const r = await fetch(`/api/releases/${releaseId}/git`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", requirementIds: missing.map((m) => m.id) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "加入失败");
    toast.success(`已加入 ${d.added} 条需求`);
    router.refresh();
    void compare();
  };
  const refOptions = [...refs.tags.map((t) => ({ v: t, l: `标签 ${t}` })), ...refs.branches.map((b) => ({ v: b, l: `分支 ${b}` }))];

  return (
    <section aria-labelledby="rel-code" className="nv-release-items nv-rel-art">
      <h2 id="rel-code" className="nv-release-items-title">
        代码对比<span className="nv-count">{refs.repos.find((r) => r.id === repoId)?.path}</span>
      </h2>
      <div className="nv-cmp-bar">
        {refs.repos.length > 1 ? (
          <select className="input" value={repoId} aria-label="仓库" onChange={(e) => (setRes(null), setFrom(""), setTo(""), void loadRefs(e.target.value))}>
            {refs.repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path}
              </option>
            ))}
          </select>
        ) : null}
        从
        <select className="input" value={from} aria-label="起点" onChange={(e) => setFrom(e.target.value)}>
          <option value="">选择起点</option>
          {refOptions.map((o) => (
            <option key={`f${o.v}`} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
        到
        <select className="input" value={to} aria-label="终点" onChange={(e) => setTo(e.target.value)}>
          <option value="">选择终点</option>
          {refOptions.map((o) => (
            <option key={`t${o.v}`} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary nv-head-btn" disabled={busy || !from || !to || from === to} onClick={() => void compare()}>
          {busy ? "对比中…" : "对比"}
        </button>
        {refs.error ? <span className="nv-tests-bad">读取标签 / 分支失败：{refs.error}</span> : null}
      </div>
      {res ? (
        <>
          <p className="nv-rel-art-warn" role="note" style={{ background: "var(--nv-bg-subtle)", color: "var(--nv-text-secondary)" }}>
            {res.commits} 次提交，关联 {res.rows.filter((r) => r.verdict !== "noCode").length} 条需求
            {res.unlinked ? `；另有 ${res.unlinked} 次提交没写编号` : ""}。会上线 {res.rows.filter((r) => r.verdict === "ship").length} 条，代码里有但不在发版里 {missing.length} 条，发版里有但还没合并代码 {res.rows.filter((r) => r.verdict === "noCode").length} 条。
          </p>
          {res.rows.length ? (
            <div className="card overflow-x-auto">
              <table className="table-compact w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="w-[80px]">编号</th>
                    <th>需求</th>
                    <th className="w-[96px]">状态</th>
                    <th className="w-[180px]">代码</th>
                    <th className="w-[120px]">结论</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nv-mono">{r.code}</td>
                      <td className="cell-title" title={r.title}>
                        <Link href={`/requirements/${r.id}#rq-code`}>{r.title}</Link>
                      </td>
                      <td>
                        <ReqStatusText statusKey={r.status} fallback={reqStatusLabel(r.status)} />
                      </td>
                      <td className="nv-flow-meta">{r.commits || r.mrs.length ? `${r.mrs.join(" ")}${r.mrs.length && r.commits ? " · " : ""}${r.commits ? `${r.commits} 次提交` : ""}` : "—"}</td>
                      <td>
                        <span className={`nv-dl-tag${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {missing.length && res.canManage && editable ? (
            <div className="flex justify-end px-5 pt-2">
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void add()}>
                把 {missing.length} 条加入发版
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="nv-flow-meta px-5">选两个标签或分支对比，看这次会带上哪些需求；打符合规则的标签后，这个发版会自动标为已上线。</p>
      )}
    </section>
  );
}
