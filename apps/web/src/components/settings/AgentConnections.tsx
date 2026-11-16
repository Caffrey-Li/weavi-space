"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Check, ChevronLeft, Copy, Plus, X } from "lucide-react";
import { AGENT_PRESETS, mcpUrlOf, presetOf, type ConnState } from "@pm-collab/core/shared/agent-clients";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

/**
 * 设置 · 个人 · 本机 Agent（T28，Figma 77 · 92 / 93）：按 Agent 生成 MCP 配置写法和专用令牌，并做连通测试。
 * 测试 = 服务端检查令牌 / 权限 + 浏览器检查地址能不能打开 + Agent 用测试码真的调一次 weavi_connection_test。
 */
type Conn = {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  baseUrl: string;
  state: ConnState;
  stateLabel: string;
  clientName: string | null;
  clientVersion: string | null;
  verifiedAt: string | null;
  lastSeenAt: string | null;
  lastTestAt: string | null;
  testDetail: string | null;
  testPrompt: string | null;
  testExpiresAt: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
};
type Check = { ok: boolean; label: string };

const READ = ["projects.read", "requirements.read", "bugs.read", "releases.read", "products.read", "docs.read"];
const WRITES: { key: string; label: string }[] = [
  { key: "requirements.create", label: "新建需求" },
  { key: "requirements.edit", label: "编辑需求" },
  { key: "board.move", label: "改需求状态" },
  { key: "bugs.edit", label: "处理 Bug" },
  { key: "docs.edit", label: "编辑文档（领测试、回传结果要用）" },
];
const TONE: Record<ConnState, string> = { verified: "is-success", testing: "is-info", failed: "is-danger", untested: "is-warning", token_invalid: "is-danger" };

const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : null);

function metaLine(c: Conn) {
  const left = daysLeft(c.tokenExpiresAt);
  const exp = left === null ? "" : `令牌 ${left} 天后到期`;
  if (c.state === "verified") return [c.clientName ? `${c.clientName}${c.clientVersion ? ` ${c.clientVersion}` : ""}` : "", c.testDetail || "", c.lastSeenAt ? `最近使用 ${fmt(c.lastSeenAt)}` : "", exp].filter(Boolean).join(" · ");
  if (c.state === "failed") return `${fmt(c.lastTestAt)} 测试没有收到调用：检查配置文件、系统地址和令牌`;
  if (c.state === "testing") return "正在等 Agent 调用测试工具";
  if (c.state === "token_invalid") return "令牌已吊销或过期：换一张令牌后重新配置";
  return ["还没测试", exp].filter(Boolean).join(" · ");
}

function CopyBtn({ text, label = "复制" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn-secondary nv-head-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => toast.success("已复制"),
          () => toast.error("复制失败，请手动选中复制"),
        );
      }}
    >
      <Copy size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

export function AgentConnections() {
  const id = useId();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Conn[] | null>(null);
  const [view, setView] = useState<{ mode: "list" } | { mode: "new" } | { mode: "setup"; id: string }>({ mode: "list" });
  const [form, setForm] = useState({ kind: "cursor", name: "", baseUrl: "", scopes: [...READ, "requirements.create", "requirements.edit", "bugs.edit", "docs.edit"], days: 90 });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/me/agents", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    setList(d?.connections || []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const cur = view.mode === "setup" ? list?.find((c) => c.id === view.id) || null : null;

  // 测试中每 2 秒刷新一次
  const testing = cur?.state === "testing";
  useEffect(() => {
    if (!testing || !cur) return;
    const cid = cur.id;
    const t = setInterval(async () => {
      const d = await fetch(`/api/me/agents/${cid}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (d?.connection) {
        setList((l) => (l || []).map((x) => (x.id === cid ? d.connection : x)));
        if (d.connection.state === "verified") toast.success("已连通");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [testing, cur, toast]);

  function openNew() {
    setForm((f) => ({ ...f, name: `${presetOf(f.kind)?.label || "Agent"} · 我的电脑`, baseUrl: window.location.origin }));
    setToken(null);
    setChecks(null);
    setView({ mode: "new" });
  }

  async function create() {
    setBusy(true);
    const r = await fetch("/api/me/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "创建失败");
    setList((l) => [d.connection, ...(l || [])]);
    setToken(d.token);
    setView({ mode: "setup", id: d.connection.id });
  }

  async function rotate(c: Conn) {
    if (!(await confirm({ title: `给「${c.name}」换一张令牌？`, body: "旧令牌立即失效，要把新的配置重新写进 Agent，然后再测试一次。", confirmLabel: "换令牌" }))) return;
    const r = await fetch(`/api/me/agents/${c.id}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "换令牌失败");
    setList((l) => (l || []).map((x) => (x.id === c.id ? d.connection : x)));
    setToken(d.token);
    setChecks(null);
    setView({ mode: "setup", id: c.id });
  }

  async function remove(c: Conn) {
    if (!(await confirm({ title: `删除「${c.name}」？`, body: "它的令牌会立即吊销，这个 Agent 就不能再访问小围空间。", confirmLabel: "删除", tone: "danger" }))) return;
    const r = await fetch(`/api/me/agents/${c.id}`, { method: "DELETE" });
    if (!r.ok) return toast.error("删除失败");
    setList((l) => (l || []).filter((x) => x.id !== c.id));
    if (view.mode === "setup") setView({ mode: "list" });
  }

  async function startTest(c: Conn) {
    setChecks(null);
    const r = await fetch(`/api/me/agents/${c.id}/test`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "测试失败");
    // 地址检查在浏览器里做：浏览器和 Agent 在同一台电脑上，能打开说明 Agent 也能连到
    let reach: Check;
    try {
      await fetch(`${c.baseUrl}/api/healthz`, { method: "GET", mode: "no-cors", cache: "no-store" });
      reach = { ok: true, label: `从这台电脑能打开 ${c.baseUrl}` };
    } catch {
      reach = { ok: false, label: `从这台电脑打不开 ${c.baseUrl}：检查地址、端口，以及电脑和服务器是否在同一网络` };
    }
    setChecks([...(d.checks || []), reach]);
    setList((l) => (l || []).map((x) => (x.id === c.id ? d.connection : x)));
  }

  async function savePatch(c: Conn, patch: Partial<Pick<Conn, "name" | "kind" | "baseUrl">>) {
    const r = await fetch(`/api/me/agents/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "保存失败");
    setList((l) => (l || []).map((x) => (x.id === c.id ? d.connection : x)));
  }

  const header = (
    <header className="nv-set-title">
      <h1>本机 Agent</h1>
      <p>让你电脑上的 Agent 通过 MCP 使用小围空间：查改需求和 Bug、读文档、领「在我的电脑执行」的测试。每个 Agent 一张专用令牌，权限不超过你本人。</p>
    </header>
  );

  if (view.mode === "list") {
    return (
      <div className="nv-set nv-ftab nv-skills nv-agents">
        {header}
        <section className="nv-itr-card" aria-labelledby={`${id}-list`}>
          <div className="nv-agents-head">
            <h2 id={`${id}-list`}>已接入</h2>
            <button type="button" className="btn-primary nv-head-btn" onClick={openNew}>
              <Plus size={14} aria-hidden="true" />
              添加 Agent
            </button>
          </div>
          {list === null ? (
            <p className="nv-skills-empty">加载中…</p>
          ) : list.length ? (
            <ul className="nv-models-list">
              {list.map((c) => (
                <li key={c.id} className="nv-models-item">
                  <div className="nv-models-item-main">
                    <b>
                      {c.name} <span className={`nv-tag ${TONE[c.state]}`}>{c.stateLabel}</span>
                    </b>
                    <p>
                      {c.kindLabel} · {metaLine(c)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary nv-head-btn"
                    onClick={() => {
                      setToken(null);
                      setView({ mode: "setup", id: c.id });
                      void startTest(c);
                    }}
                  >
                    {c.state === "verified" ? "再测一次" : "测试连接"}
                  </button>
                  <ActionMenu
                    label={`${c.name} 的操作`}
                    items={[
                      { label: "配置写法", onSelect: () => { setToken(null); setChecks(null); setView({ mode: "setup", id: c.id }); } },
                      { label: "换令牌", onSelect: () => void rotate(c) },
                      { label: "删除", tone: "danger", onSelect: () => void remove(c) },
                    ]}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="nv-skills-empty">还没有接入 Agent。点「添加 Agent」，选你用的 Agent，按生成的配置写进去，再测试一下。</p>
          )}
        </section>
        <section className="nv-itr-card" aria-labelledby={`${id}-which`}>
          <div className="nv-skills-head">
            <h2 id={`${id}-which`}>支持哪些 Agent</h2>
            <p>只要支持 MCP 就能接：能填 HTTP 地址和请求头的直接接；只支持本地命令的用 mcp-remote 转一下。ChatGPT、Grok 这类在厂商服务器上运行的，要等系统有公网 https 地址。写法按各家公开文档整理，以测试结果为准。</p>
          </div>
          <div className="nv-agents-chips">
            {AGENT_PRESETS.map((p) => (
              <span key={p.key}>{p.label}</span>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const kind = view.mode === "new" ? form.kind : cur?.kind || "generic_http";
  const preset = presetOf(kind) || AGENT_PRESETS[0];
  const base = view.mode === "new" ? form.baseUrl : cur?.baseUrl || "";
  const snippet = preset.build(mcpUrlOf(base || "http://localhost:3100"), token || "<你的令牌>");

  return (
    <div className="nv-set nv-ftab nv-skills nv-agents">
      <button type="button" className="nv-agents-back" onClick={() => { setView({ mode: "list" }); setToken(null); setChecks(null); void load(); }}>
        <ChevronLeft size={14} aria-hidden="true" />
        本机 Agent
      </button>

      <section className="nv-itr-card" aria-labelledby={`${id}-s1`}>
        <div className="nv-skills-head">
          <h2 id={`${id}-s1`}>1 选择 Agent</h2>
        </div>
        <div className="nv-agents-kinds" role="radiogroup" aria-label="Agent">
          {AGENT_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={p.key === kind}
              onClick={() => {
                if (view.mode === "new") setForm((f) => ({ ...f, kind: p.key, name: f.name.endsWith("· 我的电脑") ? `${p.label} · 我的电脑` : f.name }));
                else if (cur) void savePatch(cur, { kind: p.key });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {view.mode === "new" ? (
          <div className="nv-set-form">
            <div className="nv-set-grid">
              <label className="nv-set-field" htmlFor={`${id}-n`}>
                名称
                <input id={`${id}-n`} className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="nv-set-field" htmlFor={`${id}-u`}>
                系统地址
                <input id={`${id}-u`} className="input" value={form.baseUrl} maxLength={200} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
                <small>Agent 从你电脑访问这个地址；默认是你现在打开的地址</small>
              </label>
            </div>
            <div className="nv-set-field">
              权限（不超过你本人的权限）
              <div className="nv-agents-perms">
                <label>
                  <input type="checkbox" checked={READ.every((s) => form.scopes.includes(s))} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? Array.from(new Set([...form.scopes, ...READ])) : form.scopes.filter((s) => !READ.includes(s)) })} />
                  读取全部（项目、需求、Bug、发版、产品、文档）
                </label>
                {WRITES.map((w) => (
                  <label key={w.key}>
                    <input type="checkbox" checked={form.scopes.includes(w.key)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, w.key] : form.scopes.filter((s) => s !== w.key) })} />
                    {w.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="nv-agents-row">
              <label className="nv-agents-days" htmlFor={`${id}-d`}>
                令牌有效期
                <select id={`${id}-d`} className="input" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                  {[30, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>
                      {d} 天
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-primary nv-head-btn" disabled={busy || !form.scopes.length || !form.name.trim()} onClick={() => void create()}>
                生成配置
              </button>
            </div>
          </div>
        ) : cur ? (
          <dl className="nv-skills-kv">
            <div>
              <dt>名称</dt>
              <dd>{cur.name}</dd>
            </div>
            <div>
              <dt>系统地址</dt>
              <dd>
                <code>{cur.baseUrl}</code>
              </dd>
            </div>
            <div>
              <dt>令牌</dt>
              <dd>
                {cur.scopes.length} 项权限 · {cur.tokenExpiresAt ? `${daysLeft(cur.tokenExpiresAt)} 天后到期` : "长期"}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {view.mode === "setup" && cur ? (
        <>
          <section className="nv-itr-card" aria-labelledby={`${id}-s2`}>
            <div className="nv-agents-head">
              <div className="nv-skills-head">
                <h2 id={`${id}-s2`}>2 写进 {preset.label} 的配置</h2>
                <p>
                  {preset.where}。{token ? "令牌只显示这一次，离开页面后看不到。" : "令牌不再显示：配置里已经有令牌就不用改；要重新配置请点「换令牌」。"}
                </p>
              </div>
              {token ? (
                <CopyBtn text={snippet} />
              ) : (
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => void rotate(cur)}>
                  换令牌
                </button>
              )}
            </div>
            <pre className="nv-agents-code">
              <code>{snippet}</code>
            </pre>
            {preset.tips.length ? (
              <ul className="nv-agents-tips">
                {preset.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="nv-itr-card" aria-labelledby={`${id}-s3`}>
            <div className="nv-agents-head">
              <div className="nv-skills-head">
                <h2 id={`${id}-s3`}>3 测试连接</h2>
                <p>系统先检查令牌、权限和地址；再请你在 {preset.label} 里发一句话，它真的调到小围空间才算通过。</p>
              </div>
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void startTest(cur)}>
                {cur.state === "testing" ? "重新测试" : "开始测试"}
              </button>
            </div>
            {checks || cur.testPrompt || cur.state === "verified" || cur.state === "failed" ? (
              <div className="nv-agents-test">
                {(checks || []).map((c) => (
                  <p key={c.label} className={c.ok ? "is-ok" : "is-bad"}>
                    {c.ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                    {c.label}
                  </p>
                ))}
                {cur.testPrompt ? (
                  <div className="nv-agents-say">
                    <span>在 {preset.label} 里发这句话：</span>
                    <div>
                      <code>{cur.testPrompt}</code>
                      <CopyBtn text={cur.testPrompt} />
                    </div>
                    <p className="nv-agents-wait" role="status">
                      还在等 {preset.label} 调用（{cur.testExpiresAt ? `${fmt(cur.testExpiresAt)} 前有效` : "15 分钟内有效"}）。常见原因：配置没保存或没重启 Agent、地址从你电脑打不开、令牌复制不全。
                    </p>
                  </div>
                ) : null}
                {cur.state === "verified" ? (
                  <p className="is-ok" role="status">
                    <Check size={14} aria-hidden="true" />
                    已连通{cur.clientName ? `：${cur.clientName}${cur.clientVersion ? ` ${cur.clientVersion}` : ""}` : ""} · {fmt(cur.verifiedAt)} 收到调用{cur.testDetail ? ` · ${cur.testDetail}` : ""}
                  </p>
                ) : null}
                {cur.state === "failed" ? (
                  <p className="is-bad" role="status">
                    <X size={14} aria-hidden="true" />
                    {fmt(cur.lastTestAt)} 那次测试 15 分钟内没有收到调用。检查配置、重启 Agent 后点「开始测试」再试。
                  </p>
                ) : null}
                {cur.state === "token_invalid" ? (
                  <p className="is-bad" role="status">
                    <X size={14} aria-hidden="true" />
                    令牌已吊销或过期，请点「换令牌」，把新配置写进 Agent。
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="nv-skills-empty">把上面的配置写进 {preset.label} 并重启后，点「开始测试」。</p>
            )}
          </section>
          <div className="nv-agents-end">
            <button type="button" className="btn-ghost nv-head-btn" onClick={() => void remove(cur)}>
              删除这个 Agent
            </button>
            <button type="button" className="btn-primary nv-head-btn" onClick={() => { setView({ mode: "list" }); setToken(null); setChecks(null); void load(); }}>
              完成
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
