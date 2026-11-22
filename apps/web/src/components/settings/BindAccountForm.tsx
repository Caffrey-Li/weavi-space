"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";

export type BindStatus = { email: string | null; phone: string | null; needsBind: boolean; verify: { email: boolean; sms: boolean } };

/**
 * 设置 · 账号「登录账号」：本人绑定邮箱或手机号（邀请码登录的账号必须先绑一个才能设置密码）。
 * 系统开通了邮箱 / 短信验证码时要先收验证码；没开通直接绑定。已绑定的项只显示，不在这里改。
 */
export function BindAccountForm({ status }: { status: BindStatus }) {
  const router = useRouter();
  const id = useId();
  const options = [...(!status.email ? (["email"] as const) : []), ...(!status.phone ? (["sms"] as const) : [])];
  const [picked, setChannel] = useState<"email" | "sms">(options[0] ?? "email");
  // 绑定一项后页面刷新，剩下没绑的那项自动成为当前项
  const channel: "email" | "sms" = (options as readonly string[]).includes(picked) ? picked : (options[0] ?? "email");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "bind">("");
  const [cooldown, setCooldown] = useState(0);
  const needCode = status.verify[channel];

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function call(action: "send" | "bind") {
    setBusy(action);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/me/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, channel, target, code }) });
      const data = await res.json().catch(() => ({}));
      setBusy("");
      if (!res.ok) return setError(data.error || "操作失败");
      if (action === "send") {
        setNote(data.message || "验证码已发送");
        setCooldown(60);
        return;
      }
      setTarget("");
      setCode("");
      setNote(channel === "email" ? "邮箱已绑定" : "手机号已绑定");
      router.refresh();
    } catch {
      setBusy("");
      setError("网络异常，请重试");
    }
  }

  return (
    <div className="nv-set-form">
      {error ? (
        <div role="alert" className="banner-error" tabIndex={-1}>
          {error}
        </div>
      ) : null}
      {note ? (
        <div role="status" className="banner-success">
          {note}
        </div>
      ) : null}
      <div className="nv-set-grid">
        <div className="nv-set-field">
          <span>邮箱</span>
          <input className="input" value={status.email || "未绑定"} disabled readOnly aria-label="已绑定的邮箱" />
        </div>
        <div className="nv-set-field">
          <span>手机号</span>
          <input className="input" value={status.phone || "未绑定"} disabled readOnly aria-label="已绑定的手机号" />
        </div>
      </div>
      {options.length ? (
        <form
          className="nv-set-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void call("bind");
          }}
        >
          {options.length > 1 ? (
            <div className="nv-bind-seg" role="group" aria-label="绑定方式">
              <button type="button" aria-pressed={channel === "email"} onClick={() => setChannel("email")}>
                绑定邮箱
              </button>
              <button type="button" aria-pressed={channel === "sms"} onClick={() => setChannel("sms")}>
                绑定手机号
              </button>
            </div>
          ) : null}
          <div className="nv-set-grid">
            <Field id={`${id}-target`} label={channel === "email" ? "要绑定的邮箱" : "要绑定的手机号"} required>
              <input
                className="input"
                type={channel === "email" ? "email" : "tel"}
                inputMode={channel === "email" ? "email" : "tel"}
                placeholder={channel === "email" ? "name@company.com" : "11 位手机号"}
                autoComplete={channel === "email" ? "email" : "tel"}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
            {needCode ? (
              <Field id={`${id}-code`} label="验证码" required>
                <div className="flex gap-2">
                  <input className="input flex-1" inputMode="numeric" maxLength={6} placeholder="6 位数字" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                  <button type="button" className="btn-secondary nv-head-btn shrink-0" disabled={!target.trim() || cooldown > 0 || Boolean(busy)} onClick={() => void call("send")}>
                    {cooldown > 0 ? `${cooldown} 秒后重发` : busy === "send" ? "发送中…" : "发送验证码"}
                  </button>
                </div>
              </Field>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
          <div>
            <button type="submit" className="btn-primary nv-head-btn" disabled={Boolean(busy) || !target.trim() || (needCode && code.length < 6)} aria-busy={busy === "bind" || undefined}>
              {busy === "bind" ? "绑定中…" : "确认绑定"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
