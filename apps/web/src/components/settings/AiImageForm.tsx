"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

type View = {
  scopes: { id: string; name: string }[];
  scope: string;
  configured: boolean;
  baseUrl: string;
  model: string;
  size: string;
  price: string;
  keyMasked: string;
  updatedAt: string | null;
  updatedBy: string | null;
  usage: { userId: string; name: string; images: number; costCents: number }[];
};

/**
 * 常用的图片生成服务（都是 OpenAI 兼容的 /images/generations）。选服务商自动填地址、模型和推荐尺寸（Figma「82」41b）。
 * 背景图要横长（项目卡片 4:1 左右），各家支持的尺寸不同，这里给的是各家允许的最接近的尺寸。
 */
const PRESETS = [
  { key: "doubao", label: "火山方舟 · 豆包 Seedream", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-4-0-250828", "doubao-seedream-3-0-t2i-250415"], size: "2048x512", hint: "在火山方舟控制台开通 Seedream 模型并创建 API Key" },
  { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-image-1", "dall-e-3"], size: "1536x1024", hint: "gpt-image-1 支持 1536x1024，dall-e-3 用 1792x1024" },
  { key: "zhipu", label: "智谱 · CogView", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["cogview-4-250304", "cogview-3-flash"], size: "1440x720", hint: "在智谱开放平台创建 API Key；cogview-3-flash 免费" },
] as const;
const CUSTOM = "custom";
const presetOf = (url: string) => PRESETS.find((p) => url.replace(/\/+$/, "") === p.baseUrl)?.key || CUSTOM;

/** Figma 41：按企业配置（接口地址、模型、尺寸、单价、API Key 只写不读），下方是本月按成员的张数和费用 */
export function AiImageForm() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [view, setView] = useState<View | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [price, setPrice] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<string>(CUSTOM);
  const [customModel, setCustomModel] = useState(false);

  function apply(v: View) {
    setView(v);
    setBaseUrl(v.baseUrl);
    setModel(v.model);
    const p = presetOf(v.baseUrl);
    setProvider(p);
    setCustomModel(p === CUSTOM || !PRESETS.find((x) => x.key === p)!.models.some((m) => m === v.model));
    setSize(v.size);
    setPrice(v.price);
    setApiKey("");
  }
  const load = (scope?: string) =>
    fetch(`/api/system/ai-image${scope !== undefined ? `?scope=${encodeURIComponent(scope)}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : apply(d as View)))
      .catch(() => setError("读取失败"));
  useEffect(() => {
    void load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/system/ai-image", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: view?.scope ?? "", baseUrl, model, size, apiKey, price }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error || "保存失败");
    apply(d as View);
    toast.success("已加密保存 AI 生图配置");
  }

  async function clear() {
    const ok = await confirm({ title: "清除 AI 生图配置？", body: "清除后编辑项目时的「AI 生成」不可用，已生成的图片不受影响。", confirmLabel: "清除", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/system/ai-image?scope=${encodeURIComponent(view?.scope ?? "")}`, { method: "DELETE" });
    if (res.ok) {
      apply((await res.json()) as View);
      toast.success("已清除");
    }
  }

  if (!view) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;

  const host = (() => {
    const p = PRESETS.find((x) => x.key === presetOf(view.baseUrl));
    if (p) return p.label;
    try {
      return new URL(view.baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const preset = PRESETS.find((x) => x.key === provider);
  function chooseProvider(key: string) {
    setProvider(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p) {
      setCustomModel(true);
      return;
    }
    setBaseUrl(p.baseUrl);
    setModel(p.models[0]);
    setSize(p.size);
    setCustomModel(false);
  }

  const total = view.usage.reduce((n, u) => ({ images: n.images + u.images, cost: n.cost + u.costCents }), { images: 0, cost: 0 });
  return (
    <>
      {view.scopes.length > 1 ? (
        <label className="nv-loginmgr-scope" htmlFor={`${id}-scope`}>
          <span>配置范围</span>
          <select id={`${id}-scope`} className="input" value={view.scope} onChange={(e) => void load(e.target.value)}>
            {view.scopes.map((s) => (
              <option key={s.id || "system"} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <section className="nv-itr-card nv-ai-card" aria-label="图片生成接口">
        <div className="nv-itr-head">
          <span className="nv-itr-icon" aria-hidden="true">
            AI
          </span>
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title">图片生成接口</p>
            <p className="nv-itr-sub">{view.configured ? `${host} · ${view.model} · API Key 已加密保存` : "还没有配置，编辑项目时的「AI 生成」暂不可用"}</p>
          </div>
          <span className={`nv-tag is-dot ${view.configured ? "is-success" : "is-neutral"}`}>{view.configured ? "已配置" : "未配置"}</span>
        </div>
        <form className="nv-set-form nv-ai-form" onSubmit={submit} noValidate>
          <label className="nv-set-field" htmlFor={`${id}-prov`}>
            服务商
            <select id={`${id}-prov`} className="input" value={provider} onChange={(e) => chooseProvider(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM}>其他 OpenAI 兼容接口</option>
            </select>
            <small>{preset ? `${preset.hint}。` : ""}选服务商会自动填好地址、可选模型和推荐尺寸；选「其他 OpenAI 兼容接口」时自己填</small>
          </label>
          <label className="nv-set-field" htmlFor={`${id}-url`}>
            服务地址
            <input id={`${id}-url`} className="input" value={baseUrl} spellCheck={false} readOnly={Boolean(preset)} onChange={(e) => setBaseUrl(e.target.value)} />
            <small>接口地址末尾不带 /images/generations{preset ? "；要改地址请选「其他 OpenAI 兼容接口」" : ""}</small>
          </label>
          <div className="nv-set-grid">
            <label className="nv-set-field" htmlFor={`${id}-model`}>
              模型
              {preset && !customModel ? (
                <select
                  id={`${id}-model`}
                  className="input"
                  value={model}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM) {
                      setCustomModel(true);
                      setModel("");
                    } else setModel(e.target.value);
                  }}
                >
                  {preset.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={CUSTOM}>其他模型（手动填写）…</option>
                </select>
              ) : (
                <input id={`${id}-model`} className="input" value={model} spellCheck={false} placeholder="填写服务商的模型名称" onChange={(e) => setModel(e.target.value)} />
              )}
            </label>
            <label className="nv-set-field" htmlFor={`${id}-size`}>
              背景图尺寸
              <input id={`${id}-size`} className="input" value={size} spellCheck={false} onChange={(e) => setSize(e.target.value)} />
              <small>图标固定 1024x1024</small>
            </label>
          </div>
          <label className="nv-set-field" htmlFor={`${id}-price`}>
            单价（元 / 张）
            <input id={`${id}-price`} className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
            <small>按服务商的实际价格填写，用来核算本企业的生图费用</small>
          </label>
          <label className="nv-set-field" htmlFor={`${id}-key`}>
            API Key
            <input
              id={`${id}-key`}
              className="input"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              placeholder={view.configured ? "已加密保存，留空则保持不变" : "填写服务商控制台里的 API Key"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          {error ? (
            <p className="nv-set-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="nv-bot-ops">
            <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
            {view.configured ? (
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => void clear()}>
                清除配置
              </button>
            ) : null}
          </div>
        </form>
      </section>
      <section className="nv-itr-card nv-ai-card" aria-label="本月用量">
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title">本月用量</p>
            <p className="nv-itr-sub">共 {total.images} 张 · 合计 ¥{(total.cost / 100).toFixed(2)}（按生成时的单价计算）</p>
          </div>
        </div>
        {view.usage.length ? (
          <ul className="nv-models-list">
            {view.usage.map((u) => (
              <li key={u.userId} className="nv-models-item">
                <div className="nv-models-item-main">
                  <b>{u.name}</b>
                </div>
                <span>{u.images} 张</span>
                <span className="w-24 text-right">¥{(u.costCents / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nv-set-hint">本月还没有生成过图片。</p>
        )}
      </section>
      <p className="nv-set-hint">每个企业用自己的接口和 Key，数据互不相通；企业没配置时，本企业项目的「AI 生成」不可用。生成的图片保存在系统里，之后不再调用接口。</p>
    </>
  );
}
