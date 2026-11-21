"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jobRoleLabel } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";

type Summary =
  | { type: "demo"; name: string; kind: "readonly" | "editable"; position: string | null; orgName: string; expiresAt: string }
  | { type: "invite" | "reset"; userName: string; emailHint: string; enterprise: { name: string; code: string | null } | null; sso: { kind: string; label: string }[] };

/**
 * 登录页「邀请登录」：成员邀请 / 重置链接和体验链接共用。
 * 用链接打开（/login?invite=<令牌>）时自动识别；也可以把整条链接或邀请码粘贴进来。
 * 体验链接直接进入；成员邀请 / 重置要填邀请的账号（邮箱或手机号）核对后登录，再设置密码。
 */
export function InviteLoginPanel({ initial }: { initial: string }) {
  const router = useRouter();
  const id = useId();
  const [raw, setRaw] = useState(initial);
  const [found, setFound] = useState<{ token: string; info: Summary } | null>(null);
  const [account, setAccount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const autoChecked = useRef(false);

  async function check(value: string) {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/invite/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite: value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "邀请无效");
      else setFound({ token: data.token, info: data.info });
    } catch {
      setError("网络异常，请重试");
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!initial || autoChecked.current) return;
    autoChecked.current = true;
    void check(initial);
  }, [initial]);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    if (!found || busy) return;
    const demo = found.info.type === "demo";
    if (!demo && !account.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = demo
        ? await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: found.token }) })
        : await fetch("/api/auth/invite/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: found.token, account }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.error || "登录失败");
        // 链接已失效（用过、过期、试错太多次）：回到输入邀请那一步
        if (res.status === 410) setFound(null);
        return;
      }
      if (demo) window.location.assign("/");
      else {
        router.replace("/settings?force=1");
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError("网络异常，请重试");
    }
  }

  function reset() {
    setFound(null);
    setRaw("");
    setAccount("");
    setError("");
  }

  const alert = error ? (
    <div role="alert" className="banner-error" tabIndex={-1}>
      {error}
    </div>
  ) : null;

  if (!found) {
    return (
      <form
        className="login-form wv-login-fields"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void check(raw);
        }}
      >
        {alert}
        <div className="field">
          <label className="label" htmlFor={`${id}-invite`}>
            邀请链接或邀请码
          </label>
          <input id={`${id}-invite`} className="input" placeholder="粘贴收到的邀请链接" value={raw} onChange={(e) => setRaw(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <p className="wv-login-hint">管理员邀请你加入、重置了你的密码，或者给你发了体验账号，都在这里登录。直接点开邀请链接会自动填好。</p>
        <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || !raw.trim()} aria-busy={busy || undefined}>
          {busy ? "正在识别…" : "下一步"}
        </button>
      </form>
    );
  }

  const info = found.info;
  return (
    <form className="login-form wv-login-fields" noValidate onSubmit={enter}>
      {alert}
      <div className="wv-login-invite" role="status">
        {info.type === "demo" ? (
          <>
            <b>体验账号「{info.name}」</b>
            <dl>
              <div>
                <dt>方式</dt>
                <dd>{info.kind === "editable" ? "可编辑（演示数据，会定期重置）" : "只读（只能查看，不能新建或修改）"}</dd>
              </div>
              <div>
                <dt>身份</dt>
                <dd>
                  {info.kind === "editable" && info.position ? `${jobRoleLabel(info.position)} · ` : "访客 · "}
                  {info.orgName}
                </dd>
              </div>
              <div>
                <dt>有效期至</dt>
                <dd>{fmtDate(info.expiresAt)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <b>{info.type === "reset" ? "重置密码" : `加入${info.enterprise ? ` ${info.enterprise.name}` : "小围空间"}`}</b>
            <span>
              {info.userName}，{info.type === "reset" ? "管理员已重置你的密码。" : "你被邀请加入小围空间。"}填写邀请的账号 {info.emailHint}（或绑定的手机号）即可登录，登录后设置密码。
            </span>
          </>
        )}
        <button type="button" className="wv-login-invite-change" onClick={reset}>
          换一个邀请
        </button>
      </div>

      {info.type === "demo" ? (
        <>
          <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "正在进入…" : "进入体验"}
          </button>
          <p className="wv-login-hint">体验数据是虚构的示例企业，请不要填写真实的个人或业务信息。</p>
        </>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor={`${id}-acc`}>
              邀请的账号
            </label>
            <input
              id={`${id}-acc`}
              className="input"
              placeholder={`邮箱 ${info.emailHint} 或绑定的手机号`}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              aria-required
              required
            />
          </div>
          <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || !account.trim()} aria-busy={busy || undefined}>
            {busy ? "登录中…" : "登录"}
          </button>
          {info.sso.length ? (
            <div className="wv-login-sso" data-count={Math.min(info.sso.length, 3)}>
              {info.sso.map((p) => (
                <a
                  key={p.kind}
                  className="wv-login-ssobtn"
                  href={`/api/auth/sso/${p.kind}?${new URLSearchParams({ link: found.token, ...(info.enterprise?.code ? { org: info.enterprise.code } : {}) })}`}
                >
                  用{p.label}登录并绑定
                </a>
              ))}
            </div>
          ) : null}
        </>
      )}
    </form>
  );
}
