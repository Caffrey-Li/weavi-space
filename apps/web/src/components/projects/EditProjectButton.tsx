"use client";

import { ProductSelect } from "./ProductSelect";
import { EnterpriseSelect, useEnterprises } from "./EnterpriseSelect";
import { useConfirm } from "@/components/ui/Confirm";
import { DatePicker } from "@/components/ui/DatePicker";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw, Sparkles } from "lucide-react";
import { ART_STYLES, pickArt } from "@/lib/project-art-shared";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { ProjectIcon } from "@/components/projects/ProjectIcon";

export type ProjectEditFields = {
  id: string;
  name: string;
  key: string;
  systemName: string;
  description?: string | null;
  status: string;
  plannedEndAt?: string | Date | null;
  actualEndAt?: string | Date | null;
  launchNotes?: string | null;
  iconUrl?: string | null;
  coverUrl?: string | null;
  productId?: string | null;
  enterpriseId?: string | null;
};

function toDateInput(v?: string | Date | null) {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 2 * 1024 * 1024;
const COVER_MAX_SOURCE = 15 * 1024 * 1024;
const COVER_MAX_WIDTH = 1600;

/** 背景图上传前在浏览器里缩到 1600px 宽并转 JPEG，存库的体积通常在 300KB 以内 */
async function shrinkCover(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片无法读取"));
      el.src = url;
    });
    const scale = Math.min(1, COVER_MAX_WIDTH / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function EditProjectButton({
  project,
  className = "btn-secondary",
  withIcon = false,
}: {
  project: ProjectEditFields;
  className?: string;
  withIcon?: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState<boolean | "ai">(false);
  const [artStyle, setArtStyle] = useState<string>(() => pickArt(project.name, 0).style);
  // 图标跟随当前背景图的种子和风格，保证配色一致（新建 / 补图时种子为 0）
  const [artSeed, setArtSeed] = useState(0);
  const [aiReady, setAiReady] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(project.coverUrl || null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iconBusy, setIconBusy] = useState<boolean | "ai">(false);
  const [error, setError] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(project.iconUrl || null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: project.name,
    key: project.key,
    systemName: project.systemName,
    description: project.description || "",
    status: project.status || "active",
    plannedEndAt: toDateInput(project.plannedEndAt),
    actualEndAt: toDateInput(project.actualEndAt),
    launchNotes: project.launchNotes || "",
    productId: project.productId || "",
  });

  const confirm = useConfirm();
  const { enterprises } = useEnterprises(open);
  const [enterpriseId, setEnterpriseId] = useState(project.enterpriseId || "");
  const moving = enterprises.length > 0 && enterpriseId !== (project.enterpriseId || "");

  function openModal() {
    setEnterpriseId(project.enterpriseId || "");
    setForm({
      name: project.name,
      key: project.key,
      systemName: project.systemName,
      description: project.description || "",
      status: project.status || "active",
      plannedEndAt: toDateInput(project.plannedEndAt),
      actualEndAt: toDateInput(project.actualEndAt),
      launchNotes: project.launchNotes || "",
      productId: project.productId || "",
    });
    setIconUrl(project.iconUrl || null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    setCoverUrl(project.coverUrl || null);
    setCoverPreview(null);
    if (coverRef.current) coverRef.current.value = "";
    setError("");
    setOpen(true);
    void fetch(`/api/system/ai-image?project=${encodeURIComponent(project.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => setAiReady(Boolean(d.configured)))
      .catch(() => setAiReady(false));
  }

  /** 自动配图：内置生成立即保存；AI 生成调用管理员配置的接口 */
  async function makeArt(target: "cover" | "icon", mode: "pattern" | "ai", style?: string) {
    setError("");
    const setBusy = target === "cover" ? setCoverBusy : setIconBusy;
    setBusy(mode === "ai" ? "ai" : true);
    const st = style || artStyle;
    try {
      const res = await fetch(`/api/projects/${project.id}/art`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mode, style: mode === "pattern" ? st : undefined, seed: mode === "pattern" && target === "icon" ? artSeed : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "生成失败");
      } else {
        if (data.coverUrl) {
          setCoverUrl(data.coverUrl);
          setCoverPreview(null);
        }
        if (data.iconUrl) {
          setIconUrl(data.iconUrl);
          setPreview(null);
        }
        if (style) setArtStyle(style);
        if (target === "cover" && mode === "pattern" && typeof data.seed === "number") setArtSeed(data.seed);
        router.refresh();
      }
    } catch {
      setError("生成失败，请稍后重试");
    }
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (moving && !(await confirm({ title: "调整项目的所属企业？", body: "需求、Bug、发版、文档会一起转到新企业，所属产品会被清空。原企业的人将看不到这些内容。" }))) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        key: form.key,
        systemName: form.systemName,
        description: form.description,
        status: form.status,
        plannedEndAt: form.plannedEndAt || null,
        actualEndAt: form.actualEndAt || null,
        launchNotes: form.launchNotes,
        productId: form.productId || null,
        ...(moving ? { enterpriseId: enterpriseId || null } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "保存失败");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function uploadIcon(file: File) {
    setError("");
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("仅支持 JPEG / PNG / WebP / GIF 格式");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("图片不能超过 2MB");
      return;
    }
    setIconBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${project.id}/icon`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "上传图标失败");
        setIconBusy(false);
        return;
      }
      setIconUrl(data.iconUrl || null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setError("上传图标失败");
    }
    setIconBusy(false);
  }

  async function clearIcon() {
    setError("");
    setIconBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/icon`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "清除图标失败");
        setIconBusy(false);
        return;
      }
      setIconUrl(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setError("清除图标失败");
    }
    setIconBusy(false);
  }

  async function uploadCover(file: File) {
    setError("");
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("仅支持 JPEG / PNG / WebP / GIF 格式");
      return;
    }
    if (file.size > COVER_MAX_SOURCE) {
      setError("背景图不能超过 15MB");
      return;
    }
    setCoverBusy(true);
    setCoverPreview(URL.createObjectURL(file));
    try {
      const blob = await shrinkCover(file);
      const fd = new FormData();
      fd.append("file", blob, file.name);
      const res = await fetch(`/api/projects/${project.id}/cover`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "上传背景图失败");
        setCoverPreview(null);
      } else {
        setCoverUrl(data.coverUrl || null);
        router.refresh();
      }
    } catch {
      setError("上传背景图失败");
      setCoverPreview(null);
    }
    if (coverRef.current) coverRef.current.value = "";
    setCoverBusy(false);
  }

  async function clearCover() {
    setError("");
    setCoverBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/cover`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "清除背景图失败");
      } else {
        setCoverUrl(null);
        setCoverPreview(null);
        router.refresh();
      }
    } catch {
      setError("清除背景图失败");
    }
    setCoverBusy(false);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    void uploadIcon(file);
  }

  const dirty =
    form.name !== project.name ||
    form.key !== project.key ||
    form.systemName !== project.systemName ||
    form.description !== (project.description || "") ||
    form.status !== (project.status || "active") ||
    form.plannedEndAt !== toDateInput(project.plannedEndAt) ||
    form.actualEndAt !== toDateInput(project.actualEndAt) ||
    form.launchNotes !== (project.launchNotes || "");

  return (
    <>
      <button type="button" className={className} onClick={openModal}>
        {withIcon ? <Pencil size={14} aria-hidden="true" /> : null}
        编辑项目
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="编辑项目信息" wide dirty={dirty} busy={saving || Boolean(iconBusy) || Boolean(coverBusy)}>
        <form onSubmit={submit} className="space-y-3">
          {error ? <div role="alert" className="banner-error" tabIndex={-1}>{error}</div> : null}

          <section className="nv-art" aria-label="项目配图">
            <span className="nv-art-label">背景图</span>
            <div
              className={`nv-art-cover${coverPreview || coverUrl ? " has-image" : ""}`}
              style={coverPreview || coverUrl ? { backgroundImage: `url("${coverPreview || coverUrl}")` } : undefined}
              aria-hidden="true"
            >
              {coverPreview || coverUrl ? null : <span>未设置背景图，显示默认色带</span>}
            </div>
            <div className="nv-art-ops">
              <div className="nv-pform-seg nv-art-seg" role="group" aria-label="生成风格">
                {ART_STYLES.map((st) => (
                  <button key={st.key} type="button" aria-pressed={artStyle === st.key} disabled={Boolean(coverBusy)} onClick={() => void makeArt("cover", "pattern", st.key)}>
                    {st.label}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(coverBusy)} onClick={() => void makeArt("cover", "pattern")}>
                <RefreshCw size={14} aria-hidden="true" />
                换一张
              </button>
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(coverBusy) || !aiReady} title={aiReady ? "按项目名称和描述生成插画" : "管理员还没有在「设置 › AI 生图」配置"} onClick={() => void makeArt("cover", "ai")}>
                <Sparkles size={14} aria-hidden="true" />
                {coverBusy === "ai" ? "生成中…" : "AI 生成"}
              </button>
              <input
                ref={coverRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadCover(file);
                }}
              />
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(coverBusy)} onClick={() => coverRef.current?.click()}>
                上传
              </button>
              {coverUrl || coverPreview ? (
                <button type="button" className="btn-ghost nv-head-btn text-nv-danger-fg" disabled={Boolean(coverBusy)} onClick={() => void clearCover()}>
                  清除
                </button>
              ) : null}
            </div>
            <div className="nv-art-icon">
              <ProjectIcon name={form.name || project.name} src={preview || iconUrl} size={56} />
              <div className="min-w-0 flex-1">
                <span className="nv-art-label">项目图标</span>
                <p className="nv-set-hint">与背景图同一风格和配色，叠加项目名称首字</p>
              </div>
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(iconBusy)} onClick={() => void makeArt("icon", "pattern")}>
                <RefreshCw size={14} aria-hidden="true" />
                自动生成
              </button>
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(iconBusy) || !aiReady} title={aiReady ? "按项目名称和描述生成图标" : "管理员还没有在「设置 › AI 生图」配置"} onClick={() => void makeArt("icon", "ai")}>
                <Sparkles size={14} aria-hidden="true" />
                {iconBusy === "ai" ? "生成中…" : "AI 生成"}
              </button>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(iconBusy)} onClick={() => fileRef.current?.click()}>
                上传
              </button>
              {iconUrl || preview ? (
                <button type="button" className="btn-ghost nv-head-btn text-nv-danger-fg" disabled={Boolean(iconBusy)} onClick={() => void clearIcon()}>
                  清除
                </button>
              ) : null}
            </div>
            <p className="nv-set-hint">
              新建项目时会自动配好背景图和图标。「AI 生成」按项目名称和描述生成插画，需要管理员先在{" "}
              <a href="/system/ai-image" className="text-link">
                设置 › AI 生图
              </a>{" "}
              选服务商（默认豆包 Seedream）并填 API Key。
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <Field id={`${baseId}-name`} label="项目名称" required>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field id={`${baseId}-key`} label="标识" required>
              <input className="input font-mono uppercase" required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          {enterprises.length ? (
            <Field id={`${baseId}-enterprise`} label="所属企业" hint="只有系统管理员能看到。修改后，需求、Bug、发版、文档会一起转到新企业，所属产品会被清空">
              <EnterpriseSelect value={enterpriseId} options={enterprises} onChange={setEnterpriseId} />
            </Field>
          ) : null}
          <Field id={`${baseId}-product`} label="所属产品" hint="选填。关联后项目归到该产品下，需求可以挂到产品的功能模块">
            <ProductSelect value={form.productId} enterpriseId={enterpriseId || undefined} onChange={(v) => setForm({ ...form, productId: v })} />
          </Field>
          <Field id={`${baseId}-system`} label="系统名称" required>
            <input className="input" required value={form.systemName} onChange={(e) => setForm({ ...form, systemName: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${baseId}-status`} label="状态">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">进行中</option>
                <option value="completed">已结项</option>
                <option value="archived">已归档</option>
              </select>
            </Field>
            <Field id={`${baseId}-planned`} label="计划完成">
              <DatePicker id={`${baseId}-planned`} value={form.plannedEndAt} onChange={(v) => setForm({ ...form, plannedEndAt: v })} />
            </Field>
          </div>
          <Field id={`${baseId}-actual`} label="实际完成">
            <DatePicker id={`${baseId}-actual`} value={form.actualEndAt} onChange={(v) => setForm({ ...form, actualEndAt: v })} />
          </Field>
          <Field id={`${baseId}-desc`} label="描述">
            <textarea className="input min-h-[64px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field id={`${baseId}-notes`} label="上线安排备注">
            <textarea className="input min-h-[48px]" value={form.launchNotes} onChange={(e) => setForm({ ...form, launchNotes: e.target.value })} />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <span className="nv-pform-note">配图改动立即生效，其他信息点「保存」后生效</span>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={saving || Boolean(iconBusy) || Boolean(coverBusy)} aria-busy={saving || Boolean(iconBusy) || Boolean(coverBusy) || undefined}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
