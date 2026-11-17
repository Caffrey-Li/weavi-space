"use client";

import { useState } from "react";

/** 体验链接页：用链接里的令牌登录，成功后进入工作台 */
export function DemoEnterButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enter() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(data.error || "进入失败，请稍后再试");
    }
    window.location.assign("/");
  }

  return (
    <>
      {error ? (
        <div role="alert" className="banner-error mt-4">
          {error}
        </div>
      ) : null}
      <button type="button" className="btn-primary mt-6 inline-flex w-full justify-center" disabled={busy} aria-busy={busy || undefined} onClick={() => void enter()}>
        {busy ? "正在进入…" : "进入体验"}
      </button>
      <p className="mt-3 text-xs text-nv-text-tertiary">体验数据是虚构的示例企业，请不要填写真实的个人或业务信息。</p>
    </>
  );
}
