"use client";

import { useEffect, useState } from "react";

const EXIT = "/login?expired=1";
const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function left(ms: number) {
  if (ms <= 0) return "已到期";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `还剩 ${Math.ceil(ms / 86_400_000)} 天`;
  if (h >= 1) return `还剩 ${h} 小时`;
  return `还剩 ${Math.max(1, Math.ceil(ms / 60_000))} 分钟`;
}

/**
 * 11-24 体验账号有效期：横幅里显示到期时间和剩余时间；每分钟、以及切回这个页签时检查一次，
 * 到期或会话已失效（被停用、删除、管理员改短有效期）就清掉登录状态回登录页并提示「体验已到期」。
 */
export function DemoExpiry({ expiresAt }: { expiresAt: string | null }) {
  const [exp, setExp] = useState(expiresAt ? new Date(expiresAt).getTime() : null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let gone = false;
    const exit = () => {
      if (gone) return;
      gone = true;
      // 先清掉登录状态（会话已失效时也能清 Cookie），再回登录页提示到期
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => undefined)
        .finally(() => window.location.assign(EXIT));
    };
    const check = async () => {
      setNow(Date.now());
      if (exp && Date.now() >= exp) return exit();
      try {
        const r = await fetch("/api/auth/session", { cache: "no-store" });
        if (r.status === 401) return exit();
        const d = (await r.json().catch(() => null)) as { demoExpiresAt?: string | null } | null;
        if (d && d.demoExpiresAt !== undefined) setExp(d.demoExpiresAt ? new Date(d.demoExpiresAt).getTime() : null);
      } catch {
        /* 网络抖动：下次再查 */
      }
    };
    setNow(Date.now());
    const t = window.setInterval(() => void check(), 60_000);
    const onVis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [exp]);
  if (!exp || !now) return null;
  return (
    <span className="wv-demo-expiry" suppressHydrationWarning>
      有效期至 {fmt(new Date(exp))}（{left(exp - now)}）
    </span>
  );
}
