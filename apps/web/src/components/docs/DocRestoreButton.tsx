"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { refreshDocsTree } from "./DocsNav";

/** 历史版本：把选中的版本恢复成新的一版（原有版本都保留） */
export function DocRestoreButton({ pageId, version, hasDraft, historyHref }: { pageId: string; version: number; hasDraft: boolean; historyHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function restore() {
    const ok = await confirm({
      title: `恢复到第 ${version} 版？`,
      body: (
        <>
          会用第 {version} 版的标题和正文发布一个新版本，现有的版本记录都会保留，之后还能再恢复回来。
          {hasDraft ? " 这个页面有未发布的草稿，恢复后草稿会被丢弃。" : ""}
        </>
      ),
      confirmLabel: "恢复",
      tone: hasDraft ? "danger" : "default",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/docs/pages/${pageId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "恢复失败，请重试");
      return;
    }
    toast.success(`已恢复到第 ${version} 版，生成第 ${data.version} 版`);
    refreshDocsTree();
    router.push(`${historyHref}?v=${data.version}`);
    router.refresh();
  }

  return (
    <button type="button" className="btn-secondary" onClick={() => void restore()} disabled={busy}>
      <RotateCcw size={14} aria-hidden="true" />
      {busy ? "恢复中…" : "恢复此版本"}
    </button>
  );
}
