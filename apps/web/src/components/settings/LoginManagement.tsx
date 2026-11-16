"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type FieldView = { key: string; label: string; secret?: boolean; placeholder?: string; type?: "text" | "number" | "boolean"; value: string | boolean; hasValue: boolean; masked?: string };
type ProviderView = { kind: string; label: string; enabled: boolean; channelOnly: boolean; channelReady?: boolean; ready: boolean; fields: FieldView[] };
type Data = { scopes: { id: string; name: string }[]; scope: string; providers: ProviderView[] };

const DESC: Record<string, string> = {
  feishu: "成员在登录页扫飞书二维码登录。在飞书开放平台建企业自建应用，开通网页应用和「获取用户基本信息」权限。",
  wecom: "成员用企业微信扫码登录。在企业微信管理后台建自建应用，设置「企业微信授权登录」的可信域名。",
  dingtalk: "成员用钉钉扫码登录。在钉钉开放平台建企业内部应用，开通「个人信息读权限」并登记回调地址。",
  email: "成员在登录页填邮箱收验证码登录；邀请和重置链接也会发到邮箱。",
  sms: "成员在登录页填手机号收验证码登录（阿里云短信，按条计费，需要先通过签名和模板审核）。",
};

/**
 * 设置 · 登录管理：账号密码始终可用；飞书 / 企业微信 / 钉钉每个企业用自己的应用（只用来登录，不同步组织架构）；
 * 邮箱 / 手机验证码的发送通道在系统级配置，企业只能开关。密钥加密保存，保存后不再回显。
 */
export function LoginManagement({ initial }: { initial: Data }) {
  const router = useRouter();
  const toast = useToast();
  const baseId = useId();
  const [data, setData] = useState(initial);
  useEffect(() => setData(initial), [initial]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scopeName = data.scopes.find((s) => s.id === data.scope)?.name || "";
  const enterpriseScope = data.scope !== "";

  async function save(kind: string, body: { enabled?: boolean; config?: Record<string, unknown> }) {
    const res = await fetch("/api/system/login", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: data.scope, kind, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d.error || "保存失败" };
    setData((prev) => ({ ...prev, providers: d.providers }));
    router.refresh();
    return { ok: true };
  }

  async function toggle(p: ProviderView) {
    const r = await save(p.kind, { enabled: !p.enabled });
    if (r.error) toast.error(r.error);
    else toast.success(`${p.label}已${p.enabled ? "关闭" : "开启"}`);
  }

  function openEdit(p: ProviderView) {
    setEditing(p);
    setError("");
    setForm(Object.fromEntries(p.fields.map((f) => [f.key, f.type === "boolean" ? Boolean(f.value) : f.secret ? "" : String(f.value ?? "")])));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    const r = await save(editing.kind, { config: form });
    setBusy(false);
    if (r.error) return setError(r.error);
    toast.success(`已保存${editing.label}配置`);
    setEditing(null);
  }

  return (
    <div className="nv-set">
      <header className="nv-set-title">
        <h1>登录管理</h1>
        <p>账号密码登录始终可用。其他方式开启并配置后，会出现在{enterpriseScope ? "本企业的专属登录链接" : "登录页"}上。第三方登录只用来登录，不同步组织架构；账号仍由管理员邀请。</p>
      </header>
      {data.scopes.length > 1 ? (
        <label className="nv-loginmgr-scope" htmlFor={`${baseId}-scope`}>
          <span>配置范围</span>
          <select id={`${baseId}-scope`} className="input" value={data.scope} onChange={(e) => router.push(`/system/login?scope=${encodeURIComponent(e.target.value)}`)}>
            {data.scopes.map((s) => (
              <option key={s.id || "system"} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <ul className="nv-loginmgr-list" aria-label={`${scopeName}的登录方式`}>
        <li className="nv-loginmgr-item">
          <div className="nv-loginmgr-main">
            <b>账号密码</b>
            <p>邮箱 + 密码登录。管理员看不到密码，只能发重置链接。</p>
          </div>
          <span className="nv-tag is-success">始终开启</span>
        </li>
        {data.providers.map((p) => (
          <li key={p.kind} className="nv-loginmgr-item">
            <div className="nv-loginmgr-main">
              <b>{p.label}</b>
              <p>{DESC[p.kind]}</p>
              {p.channelOnly ? (
                <p className="nv-loginmgr-hint">{p.channelReady ? "发送通道已由系统超管配置，可以直接开启。" : "系统超管还没有配置发送通道，暂时不能开启。"}</p>
              ) : ["feishu", "wecom", "dingtalk"].includes(p.kind) && origin ? (
                <p className="nv-loginmgr-hint">
                  回调地址：<code>{p.kind === "feishu" && !enterpriseScope ? `${origin}/api/auth/feishu/callback` : `${origin}/api/auth/sso/${p.kind}/callback`}</code>
                </p>
              ) : null}
            </div>
            <div className="nv-loginmgr-actions">
              <span className={`nv-tag ${p.enabled ? "is-success" : p.ready ? "is-neutral" : "is-warning"}`}>{p.enabled ? "已开启" : p.ready ? "未开启" : "未配置"}</span>
              {!p.channelOnly ? (
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => openEdit(p)}>
                  配置
                </button>
              ) : null}
              <button
                type="button"
                className={p.enabled ? "btn-secondary nv-head-btn" : "btn-primary nv-head-btn"}
                onClick={() => void toggle(p)}
                disabled={!p.enabled && !p.ready}
                title={!p.enabled && !p.ready ? "请先完成配置" : undefined}
              >
                {p.enabled ? "关闭" : "开启"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `配置${editing.label}` : ""} busy={busy} dirty={Object.values(form).some((v) => v !== "" && v !== false)} panelClassName="nv-prod-modal nv-sm-modal">
        {editing ? (
          <form onSubmit={submit} className="nv-pform" noValidate>
            <p className="nv-pform-intro">{DESC[editing.kind]} 密钥加密保存，留空表示沿用已保存的值。</p>
            <div className="nv-pform-body">
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              {editing.fields.map((f, i) =>
                f.type === "boolean" ? (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
                    {f.label}
                  </label>
                ) : (
                  <label key={f.key} className="nv-pfield" htmlFor={`${baseId}-${f.key}`}>
                    <span className="nv-pfield-label">{f.label}</span>
                    <input
                      id={`${baseId}-${f.key}`}
                      className="input"
                      type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                      value={String(form[f.key] ?? "")}
                      placeholder={f.secret && f.hasValue ? `已保存 ${f.masked || ""}，留空不改` : f.placeholder || ""}
                      autoComplete={f.secret ? "new-password" : "off"}
                      data-initial-focus={i === 0 ? "" : undefined}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </label>
                ),
              )}
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
