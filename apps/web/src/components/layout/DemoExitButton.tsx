"use client";

import { useState } from "react";

/** 体验账号横幅里的「退出体验」：POST 退出登录再回登录页（GET 退出只处理已失效的会话，防止别的网站一个链接就把人登出） */
export function DemoExitButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="wv-demo-exit"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        window.location.assign("/login");
      }}
    >
      {busy ? "正在退出…" : "退出体验"}
    </button>
  );
}
