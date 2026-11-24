"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

type Row = { id: string; code: string; title: string; status: string; createdAt: string; productId: string | null; product: string | null; creator: string };
type Proj = { id: string; name: string; productId: string | null };
type Data = { requirements: Row[]; bugs: Row[]; projects: Proj[] };
type Kind = "requirement" | "bug";

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 设置 · 未归属需求：11-22 起需求和 Bug 都必须属于项目，把以前放在公共池的逐条或批量分到项目 */
export function UnassignedPanel() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<Kind>("requirement");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/unassigned", { cache: "no-store" });
    if (r.ok) setData((await r.json()) as Data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (data ? (kind === "bug" ? data.bugs : data.requirements) : []), [data, kind]);
  const picked = rows.filter((r) => sel.has(r.id));
  // 选中的都挂在同一个产品下时，把这个产品的项目排在前面
  const productKey = Array.from(new Set(picked.map((r) => r.productId).filter(Boolean))).join();
  const projects = useMemo(() => {
    const list = data?.projects || [];
    if (!productKey || productKey.includes(",")) return list;
    return [...list.filter((p) => p.productId === productKey), ...list.filter((p) => p.productId !== productKey)];
  }, [data, productKey]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function move(ids: string[], projectId: string) {
    if (!ids.length || !projectId) return;
    setBusy(true);
    const r = await fetch("/api/unassigned", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ids, projectId }) });
    const d = (await r.json().catch(() => ({}))) as { moved?: number; errors?: string[]; error?: string };
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "移动失败");
    if (d.moved) toast.success(`已分到「${data?.projects.find((p) => p.id === projectId)?.name || "项目"}」${d.moved} 条`);
    if (d.errors?.length) toast.error(d.errors.join("；"));
    setSel(new Set());
    await load();
    router.refresh();
  }

  const label = kind === "bug" ? "Bug" : "需求";
  return (
    <div className="nv-set nv-ftab nv-bin nv-unassigned">
      <header className="nv-set-title">
        <h1>未归属需求</h1>
        <p>需求池只在项目里：新建需求和 Bug 都要选项目。下面是以前放在公共池、还没有项目的记录，勾选后选一个项目就能分过去；负责人不在目标项目里的会自动解除。</p>
      </header>
      <div className="nv-bin-filter">
        <div className="nv-pform-seg nv-art-seg" role="group" aria-label="类型">
          {(["requirement", "bug"] as Kind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => (setKind(k), setSel(new Set()))}>
              {k === "bug" ? "Bug" : "需求"} {data ? (k === "bug" ? data.bugs : data.requirements).length : ""}
            </button>
          ))}
        </div>
        <span className="nv-unassigned-bulk">
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="目标项目">
            <option value="">选择项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary nv-head-btn" disabled={busy || !target || !picked.length} onClick={() => void move(picked.map((r) => r.id), target)}>
            分到项目{picked.length ? `（${picked.length}）` : ""}
          </button>
        </span>
      </div>
      {!data ? (
        <p className="nv-set-hint">正在读取…</p>
      ) : !rows.length ? (
        <p className="nv-itr-empty">没有未归属项目的{label}，都分好了。</p>
      ) : (
        <div className="nv-bin-table" role="table" aria-label={`未归属的${label}`}>
          <div className="nv-bin-row is-head" role="row">
            <span role="columnheader">
              <input
                type="checkbox"
                aria-label="全选"
                checked={picked.length === rows.length}
                onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            </span>
            <span role="columnheader">名称</span>
            <span role="columnheader">提出人</span>
            <span role="columnheader">创建时间</span>
            <span role="columnheader">产品</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="nv-bin-row" role="row">
              <span role="cell">
                <input type="checkbox" aria-label={`选择 ${r.title}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
              </span>
              <span role="cell" className="nv-bin-name">
                <Link href={kind === "bug" ? `/bugs/${r.id}` : `/requirements/${r.id}`} title={r.title}>
                  {r.code ? `${r.code} ` : ""}
                  {r.title}
                </Link>
              </span>
              <span role="cell">{r.creator}</span>
              <span role="cell">{stamp(r.createdAt)}</span>
              <span role="cell">{r.product || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
