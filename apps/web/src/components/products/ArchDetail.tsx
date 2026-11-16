"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Maximize, Minimize, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { archTypeLabel } from "@/lib/product-arch";
import { ArchFormModal, type ArchValues } from "./ArchFormModal";

const MIN = 0.5;
const MAX = 4;
const STEP = 0.25;

/** 架构图详情（Figma 63）：看图区（缩放、全屏）+ 说明；编辑弹窗里可以替换图片 */
export function ArchDetail({
  productId,
  canManage,
  arch,
  imageId,
  meta,
}: {
  productId: string;
  canManage: boolean;
  arch: ArchValues;
  imageId: string | null;
  meta: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else stage.current?.requestFullscreen().catch(() => toast.error("浏览器不允许全屏"));
  }
  async function remove() {
    if (!(await confirm({ title: `删除「${arch.name}」？`, body: "图片和说明会一起删除，不能恢复。", confirmLabel: "删除", tone: "danger" }))) return;
    const res = await fetch(`/api/products/${productId}/architectures/${arch.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("删除失败，请重试");
    toast.success("已删除");
    router.push(`/products/${productId}?tab=arch`);
    router.refresh();
  }

  return (
    <>
      <WorkHeader
        crumbs={[{ label: "架构展示", href: `/products/${productId}?tab=arch` }, { label: arch.name }]}
        actions={
          canManage ? (
            <>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden="true" />
                编辑
              </button>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => void remove()}>
                <Trash2 size={14} aria-hidden="true" />
                删除
              </button>
            </>
          ) : null
        }
      />
      <div className="nv-parch-detail">
        <div ref={stage} className="nv-parch-stage">
          <div className="nv-parch-scroll">
            {imageId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/attachments/${imageId}`} alt={arch.name} className={zoom === 1 ? "is-fit" : undefined} style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }} />
            ) : (
              <p className="nv-pdetail-empty">
                <ImageOff size={20} aria-hidden="true" />
                还没有图片{canManage ? "，点「编辑」上传" : ""}
              </p>
            )}
          </div>
          {imageId ? (
            <div className="nv-parch-tools" role="group" aria-label="看图工具">
              <button type="button" className="icon-button" aria-label="缩小" disabled={zoom <= MIN} onClick={() => setZoom((z) => z - STEP)}>
                <Minus size={14} aria-hidden="true" />
              </button>
              <button type="button" className="nv-parch-zoom" aria-label="恢复适应窗口" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="icon-button" aria-label="放大" disabled={zoom >= MAX} onClick={() => setZoom((z) => z + STEP)}>
                <Plus size={14} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" aria-label={full ? "退出全屏" : "全屏"} onClick={toggleFull}>
                {full ? <Minimize size={14} aria-hidden="true" /> : <Maximize size={14} aria-hidden="true" />}
              </button>
            </div>
          ) : null}
        </div>
        <div className="nv-parch-desc">
          <p className="nv-parch-meta">
            <span className="nv-tag is-info">{archTypeLabel(arch.type)}</span>
            <span className="nv-pdetail-meta">{meta}</span>
          </p>
          {arch.description ? <p className="nv-parch-text">{arch.description}</p> : null}
        </div>
      </div>
      <ArchFormModal open={editing} productId={productId} arch={arch} onClose={() => setEditing(false)} />
    </>
  );
}
