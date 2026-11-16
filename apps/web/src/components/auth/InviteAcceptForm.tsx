"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";

/** 邀请 / 重置链接页的表单：填账号邮箱或手机号 → 登录 → 去设置密码 */
export function InviteAcceptForm({ token, sso, org }: { token: string; sso: { kind: string; label: string }[]; org: string }) {
  const router = useRouter();
  const id = useId();
  const [account, setAccount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !account.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/invite/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, account }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error || "登录失败");
      return;
    }
    router.replace("/settings?force=1");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error ? (
          <div role="alert" className="banner-error" tabIndex={-1}>
            {error}
          </div>
        ) : null}
        <Field id={`${id}-acc`} label="账号邮箱或手机号" required>
          <input className="input" value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="username" required />
        </Field>
        <button type="submit" className="btn-primary w-full" disabled={busy || !account.trim()} aria-busy={busy || undefined}>
          {busy ? "登录中…" : "核对并登录"}
        </button>
      </form>
      {sso.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-nv-text-tertiary">或用企业账号登录并绑定：</p>
          {sso.map((p) => (
            <a
              key={p.kind}
              className="btn-secondary w-full justify-center"
              href={`/api/auth/sso/${p.kind}?${new URLSearchParams({ link: token, ...(org ? { org } : {}) })}`}
            >
              {p.label}登录
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
