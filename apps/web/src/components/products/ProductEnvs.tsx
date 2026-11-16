"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { ENV_NETWORKS, type ProductEnv } from "@/lib/product-envs";
import { EnvEditModal } from "./EnvEditor";

/** 产品环境（Figma 61）：每个环境一张卡片，地址表格；改动整体保存到产品的 environments */
export function ProductEnvs({ productId, canManage, initial }: { productId: string; canManage: boolean; initial: ProductEnv[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [envs, setEnvs] = useState(initial);
  /** null 关闭；-1 新增；其余是正在编辑的下标 */
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function persist(next: ProductEnv[]): Promise<string | null> {
    setBusy(true);
    const res = await fetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environments: next }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return (data as { error?: string }).error || "保存失败，请重试";
    // 服务端会清洗地址，以读回的为准
    const fresh = await fetch(`/api/products/${productId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    setEnvs((fresh?.product?.environments as ProductEnv[] | undefined) ?? next);
    router.refresh();
    return null;
  }
  async function apply(next: ProductEnv[]) {
    const problem = await persist(next);
    if (problem) toast.error(problem);
  }
  function move(i: number, by: number) {
    const next = [...envs];
    next.splice(i + by, 0, next.splice(i, 1)[0]);
    void apply(next);
  }
  async function remove(i: number) {
    const ok = await confirm({ title: `删除环境「${envs[i].name}」？`, body: `环境下的 ${envs[i].urls.length} 个地址会一起删除。`, confirmLabel: "删除", tone: "danger" });
    if (ok) void apply(envs.filter((_, j) => j !== i));
  }

  const current = editing !== null && editing >= 0 ? envs[editing] : null;
  return (
    <>
      <WorkHeader
        crumbs={[{ label: "产品环境" }]}
        count={envs.length}
        actions={
          canManage ? (
            <button type="button" className="btn-primary nv-head-btn" disabled={envs.length >= 10} onClick={() => setEditing(-1)}>
              <Plus size={14} aria-hidden="true" />
              新增环境
            </button>
          ) : null
        }
      />
      <div className="nv-pdetail-body">
        <div className="nv-penv-list">
          {envs.length ? null : <p className="nv-pdetail-empty">{canManage ? "还没有环境，点右上角「新增环境」添加开发、测试、预发、生产等环境。" : "还没有配置环境。"}</p>}
          {envs.map((env, i) => (
            <section key={env.name} className="nv-penv" aria-label={env.name}>
              <header className="nv-penv-head">
                <h2>{env.name}</h2>
                <span className="nv-pdetail-meta">{env.urls.length} 个地址</span>
                <span className="flex-1" />
                {canManage ? (
                  <>
                    <button type="button" className="icon-button" aria-label={`上移 ${env.name}`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`下移 ${env.name}`} disabled={busy || i === envs.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`编辑 ${env.name}`} disabled={busy} onClick={() => setEditing(i)}>
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`删除 ${env.name}`} disabled={busy} onClick={() => void remove(i)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </header>
              {env.urls.length ? (
                env.urls.map((u, k) => {
                  const net = ENV_NETWORKS.find((n) => n.key === u.network) ?? ENV_NETWORKS[0];
                  return (
                    <div key={k} className="nv-penv-row">
                      <span className="nv-penv-label">{u.label}</span>
                      <a className="nv-penv-url" href={u.url} target="_blank" rel="noopener noreferrer" title={u.url}>
                        <span>{u.url.replace(/^https?:\/\//, "")}</span>
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                      <span className={`nv-tag ${net.tone}`}>{net.label}</span>
                      <span className="nv-penv-note">{u.note || "—"}</span>
                    </div>
                  );
                })
              ) : (
                <p className="nv-penv-none">还没有地址</p>
              )}
            </section>
          ))}
        </div>
      </div>
      <EnvEditModal
        open={editing !== null}
        initial={current}
        takenNames={envs.filter((_, j) => j !== editing).map((e) => e.name)}
        onClose={() => setEditing(null)}
        onSave={(env) => persist(editing === -1 ? [...envs, env] : envs.map((e, j) => (j === editing ? env : e)))}
      />
    </>
  );
}
