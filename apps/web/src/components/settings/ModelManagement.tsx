"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { AgentBudgetCard } from "./AgentBudgetCard";
import { AiImageEntry } from "./AiImageEntry";

type ModelTest = { ok: boolean; at: string; ttftMs: number | null; totalMs: number; tokensPerSec: number | null; thinking: boolean; reply: string; error: string | null };
type Cred = { id: string; ownerType: string; provider: string; providerLabel: string; name: string; baseUrl: string; keyMasked: string; models: string[]; enabled: boolean; testResults?: Record<string, ModelTest>; remoteModels?: string[] };
type ConnectResult = { ok: boolean; ms: number; models: number; error: string | null };
const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} 秒`);
function testLine(t: ModelTest) {
  if (!t.ok) return t.error || "不可用";
  return [`首字 ${sec(t.ttftMs)}`, t.tokensPerSec ? `${t.tokensPerSec} token/秒` : "", t.thinking ? "会先思考" : ""].filter(Boolean).join(" · ");
}
type Member = { id: string; name: string; email: string; custom: boolean; period: string | null; limit: number | null; used: number };
type Data = {
  providers: readonly { key: string; label: string; baseUrl: string }[];
  personal: Cred[];
  enterprise: null | { id: string; name: string; list: { id: string; name: string }[]; credentials: Cred[]; defaultQuota: { period: string; limit: number } | null; members: Member[] };
  periods: Record<string, string>;
};

/**
 * 设置 · 个人 · 模型管理：
 * - 我的模型：填厂商和 API Key，系统用 Key 拉取可用模型，勾选后在 AI 助手里可选；
 * - 企业模型（企业超管）：企业成员共用，按成员设置每天 / 每周 / 每月的 token 定额，用完后该模型对他不可选。
 * Key 加密保存，保存后只显示掩码。
 */
export function ModelManagement({ initial }: { initial: Data }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [data, setData] = useState(initial);
  useEffect(() => setData(initial), [initial]);
  const [adding, setAdding] = useState<null | "user" | "enterprise">(null);
  const [form, setForm] = useState({ provider: "anthropic", name: "", baseUrl: "", apiKey: "" });
  const [picking, setPicking] = useState<Cred | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [quota, setQuota] = useState<null | { userId: string; name: string; period: string; limit: string }>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 连接测试：正在测的凭据 id，以及最近一次的连接结果
  const [testing, setTesting] = useState<string | null>(null);
  const [connect, setConnect] = useState<Record<string, ConnectResult>>({});

  async function runTest(c: Cred, model?: string) {
    setTesting(c.id);
    try {
      const res = await fetch(`/api/ai/credentials/${encodeURIComponent(c.id)}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model ? { model } : {}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(d.error || "测试失败");
      setConnect((m) => ({ ...m, [c.id]: d.connect }));
      const results = Object.values(d.results || {}) as ModelTest[];
      const bad = results.filter((r) => !r.ok).length;
      if (!d.connect.ok) toast.error(`连不上：${d.connect.error}`);
      else if (bad) toast.error(`${bad} 个模型不可用，原因见列表`);
      else toast.success(`连接正常，${results.length} 个模型都能用`);
      router.refresh();
    } finally {
      setTesting(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !adding) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/ai/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ownerType: adding, enterpriseId: adding === "enterprise" ? data.enterprise?.id : undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error || "保存失败");
    setAdding(null);
    setForm({ provider: "anthropic", name: "", baseUrl: "", apiKey: "" });
    toast.success(`已拉取 ${d.credential.models.length} 个模型，请勾选要用的`);
    setPicking(d.credential);
    setChosen(d.credential.models);
    router.refresh();
  }

  async function patch(c: Cred, body: Record<string, unknown>, okMsg: string) {
    const res = await fetch(`/api/ai/credentials/${encodeURIComponent(c.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(d.error || "保存失败");
      return null;
    }
    toast.success(okMsg);
    router.refresh();
    return d.credential as Cred;
  }

  async function openPick(c: Cred) {
    // 重新拉一次，列出这个 Key 现在能用的全部模型
    const fresh = await patch(c, { refresh: true, models: c.models }, "已刷新模型列表");
    if (!fresh) return;
    setPicking({ ...fresh, remoteModels: fresh.remoteModels || c.models });
    setChosen(c.models);
  }

  async function remove(c: Cred) {
    if (!(await confirm({ title: `删除「${c.name}」？`, body: "删除后 AI 助手里不能再选它的模型。", confirmLabel: "删除", tone: "danger" }))) return;
    const res = await fetch(`/api/ai/credentials/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("已删除");
      router.refresh();
    } else toast.error("删除失败");
  }

  async function saveQuota(e: React.FormEvent) {
    e.preventDefault();
    if (!quota || !data.enterprise) return;
    setBusy(true);
    const res = await fetch("/api/ai/quotas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enterpriseId: data.enterprise.id, userId: quota.userId, period: quota.period, tokenLimit: quota.limit === "" ? null : Number(quota.limit) }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(d.error || "保存失败");
    toast.success("已保存定额");
    setQuota(null);
    router.refresh();
  }

  const meta = data.providers.find((p) => p.key === form.provider);

  const list = (items: Cred[], owner: "user" | "enterprise") => (
    <ul className="nv-models-list" aria-label={owner === "user" ? "我的模型" : "企业模型"}>
      {items.length === 0 ? <li className="nv-models-item nv-ai-note">还没有配置。</li> : null}
      {items.map((c) => (
        <li key={c.id} className="nv-models-item">
          <div className="nv-models-item-main">
            <b>{c.name}</b> <span className="nv-tag is-neutral">{c.providerLabel}</span> {c.enabled ? null : <span className="nv-tag is-warning">已停用</span>}
            <p>
              Key {c.keyMasked}
              {c.baseUrl ? ` · ${c.baseUrl}` : ""}
            </p>
            {connect[c.id] ? (
              <p className={connect[c.id].ok ? "nv-models-conn is-ok" : "nv-models-conn is-bad"}>
                {connect[c.id].ok ? `✓ 能连上，Key 有效：${sec(connect[c.id].ms)}，这个 Key 有 ${connect[c.id].models} 个模型` : `✕ 连不上：${connect[c.id].error}`}
              </p>
            ) : null}
            <ul className="nv-models-tests">
              {c.models.slice(0, 12).map((m) => {
                const t = c.testResults?.[m];
                return (
                  <li key={m} className={t ? (t.ok ? "is-ok" : "is-bad") : ""}>
                    <span className="nv-tag is-info">{m}</span>
                    <span>{testing === c.id ? "测试中…" : t ? testLine(t) : "还没测试"}</span>
                    {t && testing !== c.id ? <small suppressHydrationWarning>{new Date(t.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small> : null}
                  </li>
                );
              })}
              {c.models.length > 12 ? <li><span className="nv-tag is-neutral">等 {c.models.length} 个</span></li> : null}
            </ul>
          </div>
          <div className="nv-loginmgr-actions">
            <button type="button" className="btn-secondary nv-head-btn" disabled={testing === c.id} onClick={() => void runTest(c)}>
              {testing === c.id ? "测试中…" : "测试连接"}
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void openPick(c)}>
              选择模型
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void patch(c, { enabled: !c.enabled }, c.enabled ? "已停用" : "已启用")}>
              {c.enabled ? "停用" : "启用"}
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void remove(c)}>
              删除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="nv-set">
      <header className="nv-set-title">
        <h1>模型管理</h1>
        <p>配置 AI 助手、AI 对话和个人能力可用的模型。填 API Key 后会自动拉取这个 Key 能用的模型；Key 加密保存，保存后不再显示。</p>
      </header>

      <section className="nv-set-section" aria-labelledby={`${id}-mine`}>
        <header>
          <h2 id={`${id}-mine`}>我的模型</h2>
          <p>只有你自己能用，不限额度（费用记在你的 Key 上）。</p>
        </header>
        {list(data.personal, "user")}
        <button type="button" className="btn-primary nv-head-btn mt-3" onClick={() => { setError(""); setAdding("user"); }}>
          添加模型
        </button>
      </section>

      {data.enterprise ? (
        <section className="nv-set-section" aria-labelledby={`${id}-ent`}>
          <header>
            <h2 id={`${id}-ent`}>企业模型 · {data.enterprise.name}</h2>
            <p>企业成员共用，在 AI 助手里排在最前面；按成员设置 token 定额，用完后该成员不能再选企业模型。</p>
          </header>
          {data.enterprise.list.length > 1 ? (
            <label className="nv-loginmgr-scope">
              <span>企业</span>
              <select className="input" value={data.enterprise.id} onChange={(e) => router.push(`/settings/models?enterprise=${encodeURIComponent(e.target.value)}`)}>
                {data.enterprise.list.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {list(data.enterprise.credentials, "enterprise")}
          <button type="button" className="btn-primary nv-head-btn mt-3" onClick={() => { setError(""); setAdding("enterprise"); }}>
            添加企业模型
          </button>

          <h3 className="mt-6 text-sm font-medium">成员 token 定额</h3>
          <div className="nv-models-list mt-2" role="table" aria-label="成员 token 定额">
            <div className="nv-quota-row is-head" role="row">
              <span role="columnheader">成员</span>
              <span role="columnheader">周期</span>
              <span role="columnheader">定额（tokens）</span>
              <span role="columnheader">本期已用</span>
              <span role="columnheader" className="sr-only">操作</span>
            </div>
            <div className="nv-quota-row" role="row">
              <span role="cell">
                <b>企业默认</b>（没单独设置的成员）
              </span>
              <span role="cell">{data.enterprise.defaultQuota ? data.periods[data.enterprise.defaultQuota.period] : "—"}</span>
              <span role="cell">{data.enterprise.defaultQuota ? data.enterprise.defaultQuota.limit.toLocaleString() : "不限"}</span>
              <span role="cell">—</span>
              <span role="cell">
                <button type="button" className="text-link" onClick={() => setQuota({ userId: "", name: "企业默认", period: data.enterprise!.defaultQuota?.period || "month", limit: data.enterprise!.defaultQuota ? String(data.enterprise!.defaultQuota.limit) : "" })}>
                  设置
                </button>
              </span>
            </div>
            {data.enterprise.members.map((m) => (
              <div key={m.id} className="nv-quota-row" role="row">
                <span role="cell" title={m.email}>
                  {m.name}
                  {m.custom ? <span className="nv-tag is-info ml-1">单独设置</span> : null}
                </span>
                <span role="cell">{m.period ? data.periods[m.period] : "—"}</span>
                <span role="cell">{m.limit === null ? "不限" : m.limit.toLocaleString()}</span>
                <span role="cell" className={m.limit !== null && m.used >= m.limit ? "text-nv-danger-fg" : undefined}>
                  {m.used.toLocaleString()}
                  {m.limit !== null && m.used >= m.limit ? "（已用完）" : ""}
                </span>
                <span role="cell">
                  <button type="button" className="text-link" onClick={() => setQuota({ userId: m.id, name: m.name, period: m.period || "month", limit: m.custom && m.limit !== null ? String(m.limit) : "" })}>
                    设置
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {data.enterprise ? <AgentBudgetCard key={data.enterprise.id} enterpriseId={data.enterprise.id} /> : null}
      <AiImageEntry />

      <Modal open={Boolean(adding)} onClose={() => setAdding(null)} title={adding === "enterprise" ? "添加企业模型" : "添加模型"} busy={busy} dirty={Boolean(form.apiKey || form.name)} panelClassName="nv-prod-modal nv-sm-modal">
        <form onSubmit={add} className="nv-pform" noValidate>
          <div className="nv-pform-body">
            {error ? (
              <div role="alert" className="banner-error" tabIndex={-1}>
                {error}
              </div>
            ) : null}
            <label className="nv-pfield" htmlFor={`${id}-prov`}>
              <span className="nv-pfield-label">厂商</span>
              <select id={`${id}-prov`} className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {data.providers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="nv-pfield" htmlFor={`${id}-name`}>
              <span className="nv-pfield-label">名称</span>
              <input id={`${id}-name`} className="input" value={form.name} maxLength={40} placeholder={meta?.label} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="nv-pfield" htmlFor={`${id}-url`}>
              <span className="nv-pfield-label">接口地址{form.provider === "openai_compat" ? "" : "（选填）"}</span>
              <input id={`${id}-url`} className="input" value={form.baseUrl} placeholder={meta?.baseUrl || "https://your-gateway.example.com/v1"} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </label>
            <label className="nv-pfield" htmlFor={`${id}-key`}>
              <span className="nv-pfield-label">API Key</span>
              <input id={`${id}-key`} className="input" type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note">保存时会用 Key 拉取模型列表</span>
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !form.apiKey.trim()} aria-busy={busy || undefined}>
              {busy ? "拉取中…" : "保存"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(picking)} onClose={() => setPicking(null)} title={picking ? `选择模型 · ${picking.name}` : ""} panelClassName="nv-prod-modal">
        {picking ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-pform-intro">勾选的模型会出现在 AI 助手的模型列表里。</p>
              <div className="nv-models-pick">
                {(picking.remoteModels || picking.models).map((m) => (
                  <label key={m} title={m}>
                    <input type="checkbox" checked={chosen.includes(m)} onChange={(e) => setChosen(e.target.checked ? [...chosen, m] : chosen.filter((x) => x !== m))} />
                    <span>{m}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">已选 {chosen.length} 个</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button
                type="button"
                className="btn-primary nv-head-btn"
                disabled={!chosen.length}
                onClick={async () => {
                  const saved = await patch(picking, { models: chosen }, "已保存，正在测试连接…");
                  if (saved) {
                    setPicking(null);
                    void runTest(saved);
                  }
                }}
              >
                保存
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(quota)} onClose={() => setQuota(null)} title={quota ? `token 定额 · ${quota.name}` : ""} busy={busy} panelClassName="nv-prod-modal nv-sm-modal">
        {quota ? (
          <form onSubmit={saveQuota} className="nv-pform" noValidate>
            <div className="nv-pform-body">
              <p className="nv-pform-intro">{quota.userId ? "留空表示跟随企业默认。" : "没有单独设置的成员都按这个默认值；留空表示不限。"}只统计企业模型的用量。</p>
              <label className="nv-pfield" htmlFor={`${id}-period`}>
                <span className="nv-pfield-label">周期</span>
                <select id={`${id}-period`} className="input" value={quota.period} onChange={(e) => setQuota({ ...quota, period: e.target.value })}>
                  {Object.entries(data.periods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nv-pfield" htmlFor={`${id}-limit`}>
                <span className="nv-pfield-label">定额（tokens）</span>
                <input id={`${id}-limit`} className="input" inputMode="numeric" value={quota.limit} placeholder={quota.userId ? "跟随企业默认" : "不限"} onChange={(e) => setQuota({ ...quota, limit: e.target.value.replace(/\D/g, "") })} />
              </label>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
                保存
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
