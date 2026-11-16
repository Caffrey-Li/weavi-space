"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

/** 设置 · 账号：退出登录（原全局栏头像菜单里的入口） */
export function LogoutButton({ className = "btn-secondary w-full" }: { className?: string } = {}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        window.location.href = "/login";
      }}
    >
      <LogOut size={14} aria-hidden="true" />
      {busy ? "正在退出…" : "退出登录"}
    </button>
  );
}
