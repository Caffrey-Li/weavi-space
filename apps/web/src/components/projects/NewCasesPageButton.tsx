"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** 项目 · 测试 · 用例库（T42）：新建一个手动维护的用例页，可选关联需求 */
export function NewCasesPageButton({ projectId, reqs }: { projectId: string; reqs: { id: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/tests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, requirementId: req || null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "新建失败");
      toast.success("已新建用例页");
      router.push(d.href);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn-primary nv-head-btn" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        新建用例页
      </button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="新建用例页" busy={busy} dirty={!!title}>
          <div className="nv-ra-form">
            <label className="nv-ra-field">
              <span className="nv-ra-label">标题</span>
              <input className="input" value={title} maxLength={200} placeholder="如 测试用例 · 企业微信登录" onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label className="nv-ra-field">
              <span className="nv-ra-label">关联需求（选填）</span>
              <select className="input" value={req} onChange={(e) => setReq(e.target.value)}>
                <option value="">不关联</option>
                {reqs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="nv-ra-hint">关联后会挂到这条需求的「资料 · 测试用例」。需求交付生成的用例不用在这里建。</span>
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => void submit()}>
              {busy ? "正在新建…" : "新建并打开"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
