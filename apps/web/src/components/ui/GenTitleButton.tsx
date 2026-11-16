"use client";

import { useState } from "react";
import { Sparkle } from "lucide-react";
import { generateTitle } from "@/lib/title-gen-shared";
import { useToast } from "@/components/ui/Toast";

/** 「根据描述生成」：从描述里提炼 20 字以内的标题（配置了大模型用 AI，否则按规则） */
export function GenTitleButton({
  getHtml,
  kind,
  onTitle,
  disabled,
}: {
  getHtml: () => string;
  kind: "requirement" | "bug";
  onTitle: (title: string) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const { title } = await generateTitle(getHtml(), kind);
      if (title) onTitle(title);
      else toast.error("先在描述里写点内容，再生成标题");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="nv-gen-title"
      onClick={() => void run()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title="根据描述提炼核心内容，生成 20 字以内的标题"
    >
      <Sparkle size={14} aria-hidden="true" />
      {busy ? "生成中…" : "根据描述生成"}
    </button>
  );
}
