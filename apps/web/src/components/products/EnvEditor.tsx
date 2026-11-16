"use client";

import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { ENV_NETWORKS, ENV_PRESETS, type ProductEnv, type ProductEnvUrl } from "@/lib/product-envs";

const blankUrl = (label = ""): ProductEnvUrl => ({ label, url: "", network: "external", note: "" });

/** 新增 / 编辑一个环境（Figma 61）：环境名 + 多个地址（名称、网址、内外网、备注），地址可排序 */
export function EnvEditModal({
  open,
  initial,
  takenNames,
  onClose,
  onSave,
}: {
  open: boolean;
  /** 空 = 新增 */
  initial: ProductEnv | null;
  takenNames: string[];
  onClose: () => void;
  /** 保存失败时返回错误文案，弹窗保留输入 */
  onSave: (env: ProductEnv) => Promise<string | null>;
}) {
  const listId = useId();
  const [env, setEnv] = useState<ProductEnv>({ name: "", urls: [blankUrl("前台")] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnv(initial ?? { name: ENV_PRESETS.find((n) => !takenNames.includes(n)) || "", urls: [blankUrl("前台")] });
    setError("");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const change = (next: ProductEnv) => {
    setEnv(next);
    setDirty(true);
  };
  const setUrl = (i: number, patch: Partial<ProductEnvUrl>) => change({ ...env, urls: env.urls.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
  const move = (i: number, by: number) => {
    const urls = [...env.urls];
    urls.splice(i + by, 0, urls.splice(i, 1)[0]);
    change({ ...env, urls });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!env.name.trim()) return setError("请填写环境名称");
    if (takenNames.includes(env.name.trim())) return setError(`环境「${env.name.trim()}」已存在`);
    setBusy(true);
    setError("");
    const problem = await onSave(env);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "编辑环境" : "新增环境"} dirty={dirty} busy={busy} panelClassName="nv-prod-modal nv-env-modal">
      <form onSubmit={submit} className="nv-pform" noValidate>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <label className="nv-pfield">
            <span className="nv-pfield-label">环境名称</span>
            <input className="input" value={env.name} maxLength={20} placeholder="如 生产" list={listId} onChange={(e) => change({ ...env, name: e.target.value })} />
            <datalist id={listId}>
              {ENV_PRESETS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <div className="nv-pfield">
            <span className="nv-pfield-label">地址</span>
            <div className="nv-env-edit">
              {env.urls.map((u, i) => (
                <div key={i} className="nv-env-card" role="group" aria-label={`地址 ${u.label || i + 1}`}>
                  <div className="nv-env-row">
                    <input className="input nv-env-name" value={u.label} maxLength={30} placeholder="名称，如 前台" aria-label="地址名称" onChange={(e) => setUrl(i, { label: e.target.value })} />
                    <input className="input nv-env-url" value={u.url} inputMode="url" placeholder="https://" aria-label={`${u.label || "地址"} 的网址`} onChange={(e) => setUrl(i, { url: e.target.value })} />
                    <button type="button" className="icon-button" aria-label={`上移 ${u.label}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`下移 ${u.label}`} disabled={i === env.urls.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`删除地址 ${u.label}`} onClick={() => change({ ...env, urls: env.urls.filter((_, j) => j !== i) })}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="nv-env-row">
                    <div className="nv-pform-seg" role="group" aria-label="网络类型">
                      {ENV_NETWORKS.map((n) => (
                        <button key={n.key} type="button" aria-pressed={u.network === n.key} onClick={() => setUrl(i, { network: n.key })}>
                          {n.label}
                        </button>
                      ))}
                    </div>
                    <input className="input nv-env-url" value={u.note} maxLength={100} placeholder="备注，如 需连 VPN" aria-label={`${u.label || "地址"} 的备注`} onChange={(e) => setUrl(i, { note: e.target.value })} />
                  </div>
                </div>
              ))}
              <button type="button" className="nv-pform-add nv-env-add" disabled={env.urls.length >= 10} onClick={() => change({ ...env, urls: [...env.urls, blankUrl()] })}>
                <Plus size={12} aria-hidden="true" />
                添加地址
              </button>
            </div>
          </div>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">只支持 http / https 地址</span>
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
