"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { Pagination } from "@/components/ui/Pagination";

type View = {
  scopes: { id: string; name: string }[];
  scope: string;
  policy: { allowTokens: boolean; scopes: string[] };
  allScopes: { read: string[]; write: string[]; labels: Record<string, string> };
  members: { id: string; name: string }[];
  tokens: { id: string; name: string; userName: string; scopes: string[]; effective: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; masked: string; agent: boolean }[];
  logs: { id: string; at: string; userName: string; channel: string; action: string; status: number }[];
  logTotal: number;
  page: number;
  pageSize: number;
  filterUserId: string | null;
  week: { userId: string; name: string; count: number }[];
};

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * T34 数据开放：① 策略（是否允许成员用 API 令牌、令牌最多能拿的读写范围）；② 成员令牌（可吊销）；③ 调用记录（近 90 天，可按成员筛选）。
 * 收紧范围对已有令牌立即生效（按交集），放宽不会让已有令牌变大。
 */
export function DataAccessPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [allow, setAllow] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: { scope?: string; userId?: string; page?: number } = {}) => {
    const sp = new URLSearchParams();
    if (q.scope !== undefined) sp.set("scope", q.scope);
    if (q.userId) sp.set("userId", q.userId);
    if (q.page) sp.set("page", String(q.page));
    const r = await fetch(`/api/system/data-access?${sp}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "读取失败");
    setError("");
    setView(d as View);
    setAllow(d.policy.allowTokens);
    setChosen(d.policy.scopes);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;
  const { labels } = view.allScopes;
  const reload = (extra: { userId?: string | null; page?: number } = {}) => load({ scope: view.scope, userId: (extra.userId === undefined ? view.filterUserId : extra.userId) || undefined, page: extra.page });

  async function save() {
    if (!view) return;
    setBusy(true);
    const r = await fetch("/api/system/data-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: view.scope, allowTokens: allow, scopes: chosen }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success("已保存，已有令牌立即按新范围生效");
    void reload();
  }

  async function revoke(t: View["tokens"][number]) {
    if (!view) return;
    if (!(await confirm({ title: `吊销「${t.userName}」的令牌「${t.name}」？`, body: t.agent ? "这是本机 Agent 的专用令牌，吊销后该 Agent 立即无法访问，需要成员在「本机 Agent」里换新令牌。" : "吊销后用它的脚本或 Agent 立即无法访问，不能恢复。", confirmLabel: "吊销", tone: "danger" }))) return;
    const r = await fetch(`/api/system/data-access/tokens/${t.id}?scope=${encodeURIComponent(view.scope)}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("已吊销");
      void reload();
    } else toast.error("吊销失败");
  }

  const toggle = (s: string, on: boolean) => setChosen((c) => (on ? Array.from(new Set([...c, s])) : c.filter((x) => x !== s)));
  const dirty = allow !== view.policy.allowTokens || chosen.length !== view.policy.scopes.length || chosen.some((s) => !view.policy.scopes.includes(s));

  return (
    <>
      {view.scopes.length > 1 ? (
        <label className="nv-loginmgr-scope" htmlFor={`${id}-scope`}>
          <span>管理范围</span>
          <select id={`${id}-scope`} className="input" value={view.scope} onChange={(e) => void load({ scope: e.target.value })}>
            {view.scopes.map((s) => (
              <option key={s.id || "system"} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-p`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-p`}>
              取数策略
            </p>
            <p className="nv-itr-sub">{view.policy.allowTokens ? `允许成员使用 API 令牌 · 最多 ${view.policy.scopes.length} 项范围` : "已关闭：成员不能新建令牌，已有令牌暂停使用"}</p>
          </div>
          <span className={`nv-tag is-dot ${view.policy.allowTokens ? "is-success" : "is-neutral"}`}>{view.policy.allowTokens ? "已开放" : "已关闭"}</span>
        </div>
        <div className="nv-set-form nv-ai-form">
          <label className="nv-set-field" htmlFor={`${id}-allow`}>
            <span className="nv-da-check">
              <input id={`${id}-allow`} type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> 允许成员使用个人 API 令牌（MCP / 开放接口）
            </span>
            <small>关闭后成员不能新建令牌，已有令牌和本机 Agent 立即无法取数；重新打开后恢复。</small>
          </label>
          <fieldset className="nv-set-field nv-da-fieldset" disabled={!allow}>
            <legend>令牌最多能拿的范围</legend>
            <div className="nv-agents-perms">
              {[...view.allScopes.read, ...view.allScopes.write].map((s) => (
                <label key={s}>
                  <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
                  {labels[s] || s}
                  {view.allScopes.write.includes(s) ? "（写）" : ""}
                </label>
              ))}
            </div>
            <small>每个人能拿到的数据仍不超过本人在系统里能看到的；这里再加一层上限。没勾的范围，已有令牌里也会立即失效。</small>
          </fieldset>
          <div className="nv-bot-ops">
            <button type="button" className="btn-primary nv-head-btn" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </section>

      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-t`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-t`}>
              成员令牌 <span className="section-count">{view.tokens.length}</span>
            </p>
            <p className="nv-itr-sub">有效期内、没有吊销的令牌。范围里划掉的是被本企业策略收回的部分。</p>
          </div>
        </div>
        {view.tokens.length ? (
          <div className="nv-token-table" role="table" aria-label="成员令牌">
            <div role="row" className="nv-token-row is-head">
              <span role="columnheader">成员 · 令牌</span>
              <span role="columnheader">范围</span>
              <span role="columnheader">最近使用</span>
              <span role="columnheader">到期</span>
              <span role="columnheader">操作</span>
            </div>
            {view.tokens.map((t) => (
              <div role="row" key={t.id} className="nv-token-row">
                <span role="cell" title={`${t.name} · ${t.masked}`}>
                  <b>{t.userName}</b> · {t.name}
                </span>
                <span role="cell" title={t.scopes.map((s) => labels[s] || s).join("、")}>
                  {t.scopes.map((s, i) => (
                    <span key={s}>
                      {i ? "、" : ""}
                      {t.effective.includes(s) ? labels[s] || s : <s>{labels[s] || s}</s>}
                    </span>
                  ))}
                </span>
                <span role="cell">{fmt(t.lastUsedAt)}</span>
                <span role="cell">{t.expiresAt ? fmt(t.expiresAt) : "长期"}</span>
                <span role="cell">
                  <button type="button" className="btn-ghost nv-head-btn" onClick={() => void revoke(t)} aria-label={`吊销 ${t.userName} 的令牌 ${t.name}`}>
                    吊销
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="nv-set-hint">还没有成员创建令牌。</p>
        )}
      </section>

      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-l`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-l`}>
              调用记录 <span className="section-count">{view.logTotal}</span>
            </p>
            <p className="nv-itr-sub">
              近 7 天：{view.week.length ? view.week.slice(0, 5).map((w) => `${w.name} ${w.count} 次`).join("，") : "没有调用"}。记录保留 90 天，只记调用了什么和结果，不记内容。
            </p>
          </div>
          <label className="nv-loginmgr-scope" htmlFor={`${id}-u`}>
            <span>成员</span>
            <select id={`${id}-u`} className="input" value={view.filterUserId || ""} onChange={(e) => void reload({ userId: e.target.value || null, page: 1 })}>
              <option value="">全部成员</option>
              {view.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {view.logs.length ? (
          <div className="nv-token-table" role="table" aria-label="调用记录">
            <div role="row" className="nv-token-row is-head">
              <span role="columnheader">时间</span>
              <span role="columnheader">调用</span>
              <span role="columnheader">成员</span>
              <span role="columnheader">方式</span>
              <span role="columnheader">结果</span>
            </div>
            {view.logs.map((l) => (
              <div role="row" key={l.id} className="nv-token-row">
                <span role="cell">{fmt(l.at)}</span>
                <span role="cell">
                  <code>{l.action}</code>
                </span>
                <span role="cell">{l.userName}</span>
                <span role="cell">{l.channel === "mcp" ? "MCP" : "开放接口"}</span>
                <span role="cell" className={l.status < 400 ? "" : "nv-da-fail"}>
                  {l.status < 400 ? "成功" : `失败 ${l.status}`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="nv-set-hint">没有调用记录。</p>
        )}
        {view.logTotal > view.pageSize ? <Pagination total={view.logTotal} page={view.page} pageSize={view.pageSize} onPageChange={(p) => void reload({ page: p })} /> : null}
      </section>
    </>
  );
}
