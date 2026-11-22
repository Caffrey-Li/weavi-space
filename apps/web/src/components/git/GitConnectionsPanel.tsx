"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

type Conn = { id: string; name: string; baseUrl: string; kind: string; tokenHint: string; allowWrite: boolean; accountName: string | null; lastCheckAt: string | null; lastError: string | null; repos: number; enterprise: string | null };
type Data = { canEdit: boolean; connections: Conn[] };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败");
  return d;
}

const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
};

/** 代码仓库连接（T44，Figma 90A） */
export function GitConnectionsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Conn | "new" | null>(null);
  const [testing, setTesting] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await call("/api/git/connections", "GET"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;
  const test = async (c: Conn) => {
    setTesting(c.id);
    try {
      const d = await call(`/api/git/connections/${c.id}/test`, "POST");
      toast.success(`连接正常：${d.accountName}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting("");
      void load();
    }
  };
  const remove = async (c: Conn) => {
    if (!(await confirm({ title: `删除连接「${c.name}」？`, body: c.repos ? `用这个连接绑定的 ${c.repos} 个仓库会一起解除，已有的代码关联记录也会删除。` : "删除后不能恢复。", confirmLabel: "删除", tone: "danger" }))) return;
    try {
      await call(`/api/git/connections/${c.id}`, "DELETE");
      toast.success("已删除");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      {data.canEdit ? (
        <div className="nv-git-head">
          <button type="button" className="btn-primary nv-head-btn" onClick={() => setEdit("new")}>
            <Plus size={14} aria-hidden="true" />
            新建连接
          </button>
        </div>
      ) : (
        <p className="nv-set-hint">只有企业超管可以配置连接；项目里绑定仓库要「编辑项目」权限。</p>
      )}
      {data.connections.length ? (
        <ul className="nv-git-list">
          {data.connections.map((c) => (
            <li key={c.id}>
              <div className="min-w-0 flex-1">
                <p className="nv-git-name">
                  {c.name}
                  <span className="nv-dl-tag">{c.kind}</span>
                  {c.enterprise ? <span className="nv-flow-meta">{c.enterprise}</span> : null}
                </p>
                <p className="nv-flow-meta">
                  {c.baseUrl}
                  {c.tokenHint ? ` · 令牌 ••••${c.tokenHint}` : ""} · {c.allowWrite ? "可写入（建分支、MR 评论）" : "只读"} · 绑定 {c.repos} 个仓库
                </p>
              </div>
              {c.lastError ? <span className="nv-dl-tag tone-danger" title={c.lastError}>连接失败 · {ago(c.lastCheckAt)}</span> : c.lastCheckAt ? <span className="nv-dl-tag tone-success">{c.accountName ? `${c.accountName} · ` : ""}{ago(c.lastCheckAt)}</span> : null}
              {data.canEdit ? (
                <>
                  <button type="button" className="btn-secondary nv-head-btn" disabled={testing === c.id} onClick={() => void test(c)}>
                    {testing === c.id ? "测试中…" : "测试连接"}
                  </button>
                  <button type="button" className="btn-secondary nv-head-btn" onClick={() => setEdit(c)}>
                    编辑
                  </button>
                  <button type="button" className="btn-ghost nv-head-btn" onClick={() => void remove(c)}>
                    删除
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="nv-ra-empty">还没有连接。gitlab.com 和公司自建的 GitLab 都可以：填地址和一个访问令牌（在 GitLab「偏好设置 › 访问令牌」创建，只读选 read_api，要建分支和写 MR 评论选 api）。</div>
      )}
      {edit ? <ConnModal conn={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => (setEdit(null), void load())} /> : null}
    </>
  );
}

function ConnModal({ conn, onClose, onDone }: { conn: Conn | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<"cloud" | "self">(conn ? (conn.kind === "gitlab.com" ? "cloud" : "self") : "cloud");
  const [v, setV] = useState({ name: conn?.name || "", baseUrl: conn?.baseUrl || "", token: "", allowWrite: conn?.allowWrite ?? false });
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...v, baseUrl: kind === "cloud" ? "https://gitlab.com" : v.baseUrl, name: v.name || (kind === "cloud" ? "gitlab.com" : "公司 GitLab"), token: v.token || undefined };
      const d = conn ? await call(`/api/git/connections/${conn.id}`, "PUT", body) : await call("/api/git/connections", "POST", body);
      toast.success(`已保存，已登录为 ${d.accountName}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={conn ? `编辑连接「${conn.name}」` : "新建 GitLab 连接"} wide busy={busy} dirty={!!v.token}>
      <div className="nv-ra-form">
        <div className="nv-ra-field">
          <span className="nv-ra-label" id="gc-kind">
            类型
          </span>
          <div className="nv-ra-seg" role="radiogroup" aria-labelledby="gc-kind">
            {(
              [
                ["cloud", "gitlab.com"],
                ["self", "公司自建"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="nv-ra-field">
          <span className="nv-ra-label">名称</span>
          <input className="input" value={v.name} maxLength={60} placeholder={kind === "cloud" ? "gitlab.com" : "公司 GitLab"} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {kind === "self" ? (
          <label className="nv-ra-field">
            <span className="nv-ra-label">地址</span>
            <input className="input" value={v.baseUrl} placeholder="https://git.example.com" onChange={(e) => set({ baseUrl: e.target.value })} />
            <span className="nv-ra-hint">GitLab 首页地址；内网地址也可以，服务器要能访问到。</span>
          </label>
        ) : null}
        <label className="nv-ra-field">
          <span className="nv-ra-label">访问令牌{conn ? `（留空 = 不改，现在是 ••••${conn.tokenHint}）` : ""}</span>
          <div className="nv-git-token">
            <input
              className="input"
              type={showToken ? "text" : "password"}
              name="gitlab-access-token"
              autoComplete="new-password"
              spellCheck={false}
              value={v.token}
              placeholder="glpat-…"
              onChange={(e) => set({ token: e.target.value.trim() })}
            />
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => setShowToken((x) => !x)}>
              {showToken ? "隐藏" : "显示"}
            </button>
          </div>
          {v.token && !v.token.startsWith("glpat-") ? <span className="nv-tests-bad">GitLab 的个人访问令牌一般以 glpat- 开头，请确认粘贴的是令牌，而不是浏览器自动填入的密码</span> : null}
          <span className="nv-ra-hint">在 GitLab「偏好设置 › 访问令牌」创建。只读用 read_api；要在系统里建分支、在 MR 里写评论，选 api。保存时会用它登录一次，确认能用。</span>
        </label>
        <label className="nv-ra-check">
          <input type="checkbox" checked={v.allowWrite} onChange={(e) => set({ allowWrite: e.target.checked })} />
          允许写入：从需求建分支、在 MR 里评论这次关联的需求（令牌要有 api 权限）
        </label>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={busy || (!conn && !v.token) || (kind === "self" && !v.baseUrl)} onClick={() => void submit()}>
          {busy ? "正在连接…" : "测试并保存"}
        </button>
      </div>
    </Modal>
  );
}
