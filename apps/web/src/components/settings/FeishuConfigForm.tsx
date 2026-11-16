"use client";

import { FormEvent, useEffect, useState } from "react";
import { CircleCheck, CircleAlert, Copy, Lock } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

type View = {
  configured: boolean;
  source: "page" | "env" | null;
  appIdMasked: string;
  secretSet: boolean;
  redirectUri: string;
  autoCreate: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  callbackUrl: string;
};

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 两个凭据都用密码框输入（默认不显示、不自动填充），提交后服务端校验并加密保存。
 * 已保存时输入框留空即「保持不变」，页面只显示 App ID 掩码，App Secret 永不回显。
 */
export function FeishuConfigForm() {
  const toast = useToast();
  const [view, setView] = useState<View | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [autoCreate, setAutoCreate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  async function load() {
    const res = await fetch("/api/system/feishu", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as View & { error?: string };
    if (!res.ok) {
      setError(data.error || "读取失败");
      return;
    }
    setView(data);
    setRedirectUri(data.redirectUri);
    setAutoCreate(data.autoCreate);
  }
  useEffect(() => {
    void load();
  }, []);

  const saved = view?.source === "page";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!saved && (!appId.trim() || !appSecret.trim())) {
      setError("请填写 App ID 和 App Secret");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/system/feishu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim(), redirectUri: redirectUri.trim(), autoCreate }),
      });
      const data = (await res.json().catch(() => ({}))) as View & { error?: string };
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setView(data);
      setAppId("");
      setAppSecret("");
      toast.success("已验证并加密保存，飞书登录已开通");
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const ok = await confirm({
      title: "清除飞书凭据？",
      body: "清除后登录页的「飞书登录」将不可用，已有账号不受影响。",
      confirmLabel: "清除",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch("/api/system/feishu", { method: "DELETE" });
    if (res.ok) {
      setView(await res.json());
      toast.success("已清除飞书凭据");
    }
  }

  if (!view) {
    return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;
  }

  return (
    <>
      <section className="nv-itr-card" aria-label="当前状态">
        <div className="nv-itr-head">
          <span className="nv-itr-icon" aria-hidden="true">
            <Lock size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title">飞书企业自建应用</p>
            <p className="nv-itr-sub">
              {view.configured
                ? `App ID ${view.appIdMasked} · App Secret 已加密保存${view.source === "env" ? "（来自环境变量）" : ""}`
                : "还没有填写凭据，登录页的「飞书登录」暂不可用"}
            </p>
          </div>
          <span className={`nv-tag is-dot ${view.configured ? "is-success" : "is-neutral"}`}>{view.configured ? "已开通" : "未开通"}</span>
        </div>
        <div className="nv-itr-status">
          {view.configured ? (
            <CircleCheck size={16} className="nv-itr-ok" aria-hidden="true" />
          ) : (
            <CircleAlert size={16} className="nv-itr-none" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="nv-itr-status-title">回调地址（填到飞书「安全设置 › 重定向 URL」）</p>
            <p className="nv-itr-sub" title={view.callbackUrl}>
              {view.callbackUrl}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary nv-head-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(view.callbackUrl);
              toast.success("已复制回调地址");
            }}
          >
            <Copy size={14} aria-hidden="true" />
            复制
          </button>
        </div>
        {view.updatedAt ? (
          <p className="nv-set-hint" style={{ marginTop: 10 }}>
            最近由 {view.updatedBy || "管理员"} 于 {stamp(view.updatedAt)} 更新
          </p>
        ) : null}
      </section>

      <section className="nv-set-section" aria-labelledby="fs-cred" style={{ marginTop: 28 }}>
        <header>
          <h2 id="fs-cred">{saved ? "更换凭据" : "填写凭据"}</h2>
          <p>在飞书开放平台「凭证与基础信息」里复制。保存时会先向飞书校验，校验通过才会保存。</p>
        </header>
        <form className="nv-set-form" onSubmit={submit} autoComplete="off">
          <div className="nv-set-grid">
            <label className="nv-set-field">
              App ID
              <PasswordInput
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder={saved ? `已保存 ${view.appIdMasked}，留空保持不变` : "cli_ 开头"}
                autoComplete="off"
                spellCheck={false}
                aria-label="App ID"
              />
            </label>
            <label className="nv-set-field">
              App Secret
              <PasswordInput
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={saved ? "已加密保存，留空保持不变" : "粘贴 App Secret"}
                autoComplete="new-password"
                spellCheck={false}
                aria-label="App Secret"
              />
            </label>
          </div>
          <label className="nv-set-field">
            回调地址（可选）
            <input
              className="input"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder={`留空自动使用 ${view.callbackUrl}`}
              spellCheck={false}
            />
            <small>只有在站点域名和上面显示的不一致时才需要填写，必须和飞书里登记的完全一致。</small>
          </label>
          <label className="nv-switch" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} />
            <span aria-hidden="true" />
            飞书账号首次登录时自动开通为普通成员（关闭后只允许管理员事先添加的账号登录）
          </label>
          {error ? (
            <p className="nv-set-error" role="alert">
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "正在校验…" : "校验并保存"}
            </button>
            {saved ? (
              <button type="button" className="btn-secondary" onClick={() => void clear()}>
                清除凭据
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </>
  );
}
