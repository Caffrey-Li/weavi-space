"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";

/** 个人能力页：写进文档空间时按 Wiki 规范排版（每人自己开关，默认开） */
export function WikiStyleToggle() {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/me/wiki-style")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { on: boolean; available: boolean } | null) => {
        if (live && d?.available) setOn(d.on);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (on === null) return null;

  async function change(next: boolean) {
    setBusy(true);
    setOn(next);
    const res = await fetch("/api/me/wiki-style", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setOn(!next);
      return toast.error(data.error || "保存失败");
    }
    toast.success(next ? "已开启：写进文档空间时按 Wiki 规范排版" : "已关闭 Wiki 规范排版");
  }

  return (
    <div className="nv-skill-wiki-pref">
      <div className="nv-skill-wiki-pref-text">
        <b id="wiki-style-label">写进文档空间时按 Wiki 规范排版</b>
        <span id="wiki-style-desc">生成 PRD、个人能力存到空间、需求交付对话改 PRD 时，按内置「Wiki 排版」组织标题、表格、流程图和提示块。关闭后按模型默认格式输出。只对你自己生效。</span>
      </div>
      <label className="nv-switch">
        <input type="checkbox" checked={on} disabled={busy} aria-labelledby="wiki-style-label" aria-describedby="wiki-style-desc" onChange={(e) => void change(e.target.checked)} />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}
