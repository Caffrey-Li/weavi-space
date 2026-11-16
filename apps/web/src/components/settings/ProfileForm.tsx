"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 2 * 1024 * 1024;

/** 设置 · 账号 · 资料（Figma 15）：头像（选图即上传）、姓名可改；账号 / 岗位 / 全局角色只读 */
export function ProfileForm({
  name: initialName,
  avatarUrl,
  account,
  jobRole,
  globalRole,
}: {
  name: string;
  avatarUrl?: string | null;
  account: string;
  jobRole: string;
  globalRole: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState<"" | "avatar" | "remove" | "save">("");
  const [error, setError] = useState("");

  async function upload(f: File) {
    setError("");
    if (!ACCEPT.split(",").includes(f.type)) return setError("仅支持 JPG、PNG、WebP、GIF 格式");
    if (f.size > MAX_BYTES) return setError("图片不能超过 2MB");
    setBusy("avatar");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/auth/avatar", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "上传失败");
      toast.success("头像已更新");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy("");
      if (file.current) file.current.value = "";
    }
  }

  async function remove() {
    setError("");
    setBusy("remove");
    try {
      const res = await fetch("/api/auth/avatar", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "移除失败");
      toast.success("已移除头像");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy("");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("姓名不能为空");
    setError("");
    setBusy("save");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "保存失败");
      toast.success("资料已保存");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="nv-set-form" onSubmit={save}>
      <div className="nv-set-avatar">
        <Avatar name={initialName} src={avatarUrl} size={48} />
        <div>
          <div className="nv-set-avatar-actions">
            <input ref={file} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(busy)} onClick={() => file.current?.click()}>
              {busy === "avatar" ? "上传中…" : "更换头像"}
            </button>
            {avatarUrl ? (
              <button type="button" className="btn-ghost nv-head-btn" disabled={Boolean(busy)} onClick={() => void remove()}>
                {busy === "remove" ? "移除中…" : "移除"}
              </button>
            ) : null}
          </div>
          <p className="nv-set-hint">支持 JPG、PNG，不超过 2MB</p>
        </div>
      </div>
      <div className="nv-set-grid">
        <label className="nv-set-field" htmlFor={`${id}-name`}>
          <span>姓名</span>
          <input id={`${id}-name`} className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nv-set-field" htmlFor={`${id}-acc`}>
          <span>账号</span>
          <input id={`${id}-acc`} className="input" value={account} disabled readOnly />
          <small>账号由管理员分配，不能修改</small>
        </label>
        <label className="nv-set-field" htmlFor={`${id}-job`}>
          <span>岗位</span>
          <select id={`${id}-job`} className="input" value="x" disabled>
            <option value="x">{jobRole}</option>
          </select>
          <small>在项目中的职责，由管理员在「组织 · 成员管理」中设置</small>
        </label>
        <label className="nv-set-field" htmlFor={`${id}-role`}>
          <span>角色</span>
          <select id={`${id}-role`} className="input" value="x" disabled>
            <option value="x">{globalRole}</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="nv-set-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn-primary nv-head-btn" disabled={Boolean(busy) || name.trim() === initialName}>
          {busy === "save" ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
