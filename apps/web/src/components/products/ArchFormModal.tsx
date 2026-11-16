"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ARCH_IMAGE_ACCEPT, ARCH_TYPES, archImageProblem } from "@/lib/product-arch";

export type ArchValues = { id: string; type: string; name: string; description: string };

/** 新建 / 编辑架构图（Figma 62）：类型、名称、图片、说明 */
export function ArchFormModal({ open, productId, arch, onClose }: { open: boolean; productId: string; arch: ArchValues | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ type: "system", name: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(arch ? { type: arch.type, name: arch.name, description: arch.description } : { type: "system", name: "", description: "" });
    setFile(null);
    setError("");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.name.trim()) return setError("请填写名称");
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("type", form.type);
    fd.set("name", form.name.trim());
    fd.set("description", form.description);
    if (file) fd.set("file", file);
    const base = `/api/products/${productId}/architectures`;
    const res = await fetch(arch ? `${base}/${arch.id}` : base, { method: arch ? "PATCH" : "POST", body: fd }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((data as { error?: string }).error || "保存失败，输入已保留");
    onClose();
    toast.success(arch ? "架构图已保存" : `已新建「${form.name.trim()}」`);
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={arch ? "编辑架构图" : "新建架构图"} dirty={dirty} busy={busy} panelClassName="nv-prod-modal">
      <form onSubmit={submit} className="nv-pform" noValidate>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <label className="nv-pfield">
            <span className="nv-pfield-label">类型</span>
            <select className="input" value={form.type} onChange={(e) => set({ type: e.target.value })}>
              {ARCH_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="nv-pfield">
            <span className="nv-pfield-label">名称</span>
            <input className="input" value={form.name} maxLength={60} placeholder="如 系统部署架构" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="nv-pfield">
            <span className="nv-pfield-label">图片</span>
            <div className="nv-parch-pick">
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={14} aria-hidden="true" />
                {arch ? "替换图片" : "选择图片"}
              </button>
              <span className="nv-pdetail-meta">{file ? file.name : "PNG / JPG / SVG / WebP，不超过 5MB"}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={ARCH_IMAGE_ACCEPT}
              aria-label="选择架构图图片"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                const problem = f ? archImageProblem(f) : "";
                setError(problem);
                if (f && !problem) {
                  setFile(f);
                  setDirty(true);
                }
              }}
            />
          </div>
          <label className="nv-pfield">
            <span className="nv-pfield-label">说明</span>
            <textarea className="input nv-pform-desc" value={form.description} maxLength={2000} placeholder="这张图说明什么、什么时候更新" onChange={(e) => set({ description: e.target.value })} />
          </label>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note" />
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
