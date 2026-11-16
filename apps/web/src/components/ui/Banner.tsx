"use client";

import { useState } from "react";
import { CircleAlert, Info, X } from "lucide-react";

/** 可关闭的提示条（Plane 稿）：info 蓝底 / warning 黄底，关闭只在本次浏览生效 */
export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning";
  title: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const Icon = tone === "warning" ? CircleAlert : Info;
  return (
    <div className={`info-banner tone-${tone}`} role={tone === "warning" ? "status" : "note"}>
      <Icon size={18} aria-hidden="true" className="info-banner-icon" />
      <div className="min-w-0 flex-1">
        <p className="info-banner-title">{title}</p>
        {children ? <div className="info-banner-body">{children}</div> : null}
      </div>
      <button type="button" className="icon-button" aria-label="关闭提示" onClick={() => setOpen(false)}>
        <X size={16} />
      </button>
    </div>
  );
}
