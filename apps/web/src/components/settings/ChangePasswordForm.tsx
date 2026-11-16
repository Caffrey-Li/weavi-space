"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_HINT, passwordProblem } from "@/lib/password-policy";

export function ChangePasswordForm({ force, hasPassword = true }: { force?: boolean; hasPassword?: boolean }) {
  const router = useRouter();
  const baseId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setOkMsg("");
    const problem = passwordProblem(newPassword);
    if (problem) {
      setError(problem);
      return;
    }
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error || "修改失败");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      if (force) {
        // 首次设置 / 被要求修改：先给成功提示，再整页进入工作台（不用客户端路由，避免沿用改密前缓存的跳转）
        setOkMsg(hasPassword ? "密码已修改，正在进入工作台…" : "密码已设置，正在进入工作台…");
        setDone(true);
        window.setTimeout(() => window.location.assign("/"), 1200);
        return;
      }
      setOkMsg("密码已更新");
      router.refresh();
    } catch {
      setLoading(false);
      setError("网络异常，请重试");
    }
  }

  return (
    <form onSubmit={onSubmit} className="nv-set-form">
      {error ? (
        <div role="alert" className="banner-error" tabIndex={-1}>
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div role="status" className="banner-success">
          {okMsg}
        </div>
      ) : null}
      <div className="nv-set-grid">
      {hasPassword ? (
        <>
          <Field id={`${baseId}-current`} label="当前密码" required>
            <PasswordInput
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <span aria-hidden="true" />
        </>
      ) : null}
      <Field id={`${baseId}-new`} label="新密码" required hint={PASSWORD_HINT}>
        <PasswordInput
          required
          minLength={10}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Field>
      <Field id={`${baseId}-confirm`} label="确认新密码" required>
        <PasswordInput
          required
          minLength={10}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      </div>
      <div>
        <button type="submit" className="btn-primary nv-head-btn" disabled={loading || done} aria-busy={loading || undefined}>
          {done ? "即将跳转…" : loading ? "保存中…" : !hasPassword ? "设置并继续" : force ? "修改并继续" : "修改密码"}
        </button>
      </div>
    </form>
  );
}
