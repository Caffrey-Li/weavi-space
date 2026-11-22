"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jobRoleLabel } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";

type Summary =
  | { type: "demo"; name: string; kind: "readonly" | "editable"; position: string | null; orgName: string; expiresAt: string }
  | { type: "invite" | "reset"; userName: string; emailHint: string; needAccount: boolean; enterprise: { name: string; code: string | null } | null; sso: { kind: string; label: string }[] };

/**
 * 登录页「邀请登录」：成员邀请 / 重置链接和体验链接共用。
 * 手动输入 8 位邀请码点「登录」直接登录（登录后绑定邮箱或手机号、设置密码）；
 * 用链接打开（/login?invite=<码>）时先显示是谁的邀请，点「登录」才用掉邀请码（避免聊天软件预览链接时把码用掉）。
 * 体验链接点「进入体验」；重置链接要填账号（邮箱或手机号）核对。
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

  async function check(value: string, direct: boolean) {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/invite/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite: value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "邀请码无效");
      else if (direct && data.info?.type === "invite" && !data.info.needAccount) return void (await accept(data.token, ""));
      else setFound({ token: data.token, info: data.info });
    } catch {
      setError("网络异常，请重试");
    }
    setBusy(false);
  }

  /** 成员邀请 / 重置：登录后去设置页（绑定邮箱或手机号、设置密码） */
  async function accept(token: string, acc: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/invite/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, account: acc }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.error || "登录失败");
        // 邀请已失效（用过、过期、试错太多次）：回到输入邀请码那一步
        if (res.status === 410) setFound(null);
        return;
      }
      router.replace("/settings?force=1");
      router.refresh();
    } catch {
      setBusy(false);
      setError("网络异常，请重试");
    }
  }

  useEffect(() => {
    if (!initial || autoChecked.current) return;
    autoChecked.current = true;
    void check(initial, false);
  }, [initial]);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    if (!found || busy) return;
    if (found.info.type !== "demo") {
      if (found.info.needAccount && !account.trim()) return;
      return void (await accept(found.token, found.info.needAccount ? account : ""));
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: found.token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.error || "进入失败");
        if (res.status === 410) setFound(null);
        return;
      }
      window.location.assign("/");
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
          void check(raw, true);
        }}
      >
        {alert}
        <div className="field">
          <label className="label" htmlFor={`${id}-invite`}>
            邀请码
          </label>
          <input id={`${id}-invite`} className="input" placeholder="8 位邀请码，例如 K7QM-3XPA" value={raw} onChange={(e) => setRaw(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </div>
        <p className="wv-login-hint">管理员发给你的邀请码；直接打开邀请链接会自动填好。也可以粘贴整条邀请或体验链接。</p>
        <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || !raw.trim()} aria-busy={busy || undefined}>
          {busy ? "登录中…" : "登录"}
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
              {info.userName}，
              {info.type === "reset"
                ? `管理员已重置你的密码。填写账号${info.emailHint ? ` ${info.emailHint}` : ""}（或绑定的手机号）核对后登录，再设置新密码。`
                : "你被邀请加入小围空间。点「登录」即可进入，再绑定邮箱或手机号、设置密码。"}
            </span>
          </>
        )}
        <button type="button" className="wv-login-invite-change" onClick={reset}>
          换一个邀请码
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
          {info.needAccount ? (
          <div className="field">
            <label className="label" htmlFor={`${id}-acc`}>
              账号
            </label>
            <input
              id={`${id}-acc`}
              className="input"
              placeholder={info.emailHint ? `邮箱 ${info.emailHint} 或绑定的手机号` : "邮箱或绑定的手机号"}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              aria-required
              required
            />
          </div>
          ) : null}
          <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || (info.needAccount && !account.trim())} aria-busy={busy || undefined}>
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
