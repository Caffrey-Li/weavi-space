"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { RichTextEditor, type RichTextHandle } from "@/components/editor/RichTextEditor";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

type Saved = { html: string; updatedAt: string | null; updatedBy: string | null };

/** 产品介绍（Figma 60）：富文本，阅读 / 编辑两态，页头显示最后更新人和时间 */
export function ProductIntro({ productId, canManage, initial }: { productId: string; canManage: boolean; initial: Saved }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const editor = useRef<RichTextHandle>(null);
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/products/${productId}/intro`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: editor.current?.getHtml() ?? "" }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return toast.error((data as { error?: string }).error || "保存失败，内容已保留");
    setSaved(data as Saved);
    setEditing(false);
    setDirty(false);
    toast.success("产品介绍已保存");
    router.refresh();
  }

  async function cancel() {
    if (dirty && !(await confirm({ title: "放弃修改？", body: "这次编辑的内容不会保存。", confirmLabel: "放弃", tone: "danger" }))) return;
    setEditing(false);
    setDirty(false);
  }

  return (
    <>
      <WorkHeader
        crumbs={[{ label: "产品介绍" }]}
        actions={
          editing ? (
            <>
              <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void cancel()}>
                取消
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => void save()}>
                保存
              </button>
            </>
          ) : (
            <>
              {saved.updatedAt ? (
                <span className="nv-pdetail-meta" suppressHydrationWarning>
                  {saved.updatedBy || "—"} 更新于 {format(new Date(saved.updatedAt), "yyyy-MM-dd HH:mm")}
                </span>
              ) : null}
              {canManage ? (
                <button type="button" className="btn-primary nv-head-btn" onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden="true" />
                  编辑
                </button>
              ) : null}
            </>
          )
        }
      />
      <div className="nv-pdetail-body">
        <div className="nv-pintro">
          {editing ? (
            <RichTextEditor ref={editor} ariaLabel="产品介绍" initialHtml={saved.html} placeholder="介绍产品定位、目标用户和核心能力" ownerType="product" autoFocus onChange={() => setDirty(true)} />
          ) : saved.html ? (
            <div className="doc-content" dangerouslySetInnerHTML={{ __html: saved.html }} />
          ) : (
            <p className="nv-pdetail-empty">{canManage ? "还没有产品介绍，点右上角「编辑」填写。" : "还没有产品介绍。"}</p>
          )}
        </div>
      </div>
    </>
  );
}
