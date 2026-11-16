"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";

/**
 * 站内看大图（T31）：在弹窗里放大，Esc / 关闭按钮回到原页面。
 * 不用 target=_blank：桌面客户端、内嵌浏览器里新窗口会盖住原页面且没有返回。
 */
export function ImageViewerButton({ src, alt, className, children }: { src: string; alt: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState(true);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={`放大查看：${alt}`}>
        {children}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={alt} wide panelClassName="nv-imgview-modal">
        <div className="nv-imgview">
          <button type="button" className={`nv-imgview-stage${fit ? "" : " is-full"}`} onClick={() => setFit((v) => !v)} title={fit ? "点击看原始大小" : "点击缩放到窗口"}>
            <img src={src} alt={alt} />
          </button>
          <div className="nv-pform-foot">
            <span className="nv-pform-note">{fit ? "点击图片看原始大小" : "点击图片缩放到窗口"}</span>
            <a className="btn-secondary nv-head-btn" href={src} download>
              下载
            </a>
            <ModalCancelButton className="btn-primary nv-head-btn">关闭</ModalCancelButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
