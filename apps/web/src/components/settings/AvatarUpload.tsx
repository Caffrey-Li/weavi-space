"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 2 * 1024 * 1024;

export function AvatarUpload({
  name,
  avatarUrl,
  meta,
}: {
  name: string;
  avatarUrl?: string | null;
  /** 头像下方一行：账号 · 岗位 */
  meta?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const displaySrc = preview || avatarUrl || null;
  const hasAvatar = Boolean(avatarUrl);

  function validate(file: File): string | null {
    if (!ACCEPT.split(",").includes(file.type)) {
      return "仅支持 JPEG / PNG / WebP / GIF 格式";
    }
    if (file.size > MAX_BYTES) {
      return "图片不能超过 2MB";
    }
    return null;
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setOkMsg("");
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validate(file);
    if (err) {
      setError(err);
      e.target.value = "";
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  async function upload() {
    setError("");
    setOkMsg("");
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("请先选择图片");
      return;
    }
    const err = validate(file);
    if (err) {
      setError(err);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/auth/avatar", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "上传失败");
        setLoading(false);
        return;
      }
      setOkMsg("头像已更新");
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      setLoading(false);
      router.refresh();
    } catch {
      setLoading(false);
      setError("网络错误，请稍后重试");
    }
  }

  async function clearAvatar() {
    setError("");
    setOkMsg("");
    setClearing(true);
    try {
      const res = await fetch("/api/auth/avatar", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "清除失败");
        setClearing(false);
        return;
      }
      setOkMsg("已清除头像");
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      setClearing(false);
      router.refresh();
    } catch {
      setClearing(false);
      setError("网络错误，请稍后重试");
    }
  }

  return (
    <div className="profile-card">
      <Avatar name={name} src={displaySrc} size={52} />
      <div className="profile-name">{name}</div>
      <p className="profile-meta">{meta}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onPick}
        />
        <button
          type="button"
          className="btn-outline"
          title="支持 JPEG / PNG / WebP / GIF，最大 2MB"
          onClick={() => inputRef.current?.click()}
          disabled={loading || clearing}
        >
          {hasAvatar || preview ? "更换头像" : "上传头像"}
        </button>
        {preview && (
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={upload}
            disabled={loading || clearing}
          >
            {loading ? "上传中…" : "确认上传"}
          </button>
        )}
        {hasAvatar && !preview && (
          <button
            type="button"
            className="btn-ghost text-sm text-neutral-500"
            onClick={clearAvatar}
            disabled={loading || clearing}
          >
            {clearing ? "清除中…" : "清除头像"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-nv-danger-fg">{error}</p>}
      {okMsg && <p className="text-sm text-emerald-600">{okMsg}</p>}
    </div>
  );
}
