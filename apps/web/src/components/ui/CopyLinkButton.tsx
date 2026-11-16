"use client";

import { Link2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** 复制当前页面地址 */
export function CopyLinkButton({ label = "复制链接" }: { label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard
          ?.writeText(window.location.href)
          .then(() => toast.success("链接已复制"))
          .catch(() => toast.error("复制失败，请手动复制地址栏"));
      }}
    >
      <Link2 size={16} aria-hidden="true" />
    </button>
  );
}
