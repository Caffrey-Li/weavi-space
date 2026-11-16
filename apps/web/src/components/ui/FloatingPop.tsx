"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Pos = { top?: number; bottom?: number; left: number; maxHeight: number; up: boolean };

const GAP = 4;
const EDGE = 12;

/**
 * 浮层：挂到所在弹窗层（.clarity-layer，没有 transform）或 body 上，按触发按钮定位。
 * 下方空间不够时自动向上翻；高度不超过可用空间（超出可滚动），所以不会被弹窗裁掉。
 */
export function FloatingPop({
  anchorRef,
  open,
  onClose,
  width,
  className = "",
  role,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width: number;
  className?: string;
  role?: string;
  label?: string;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const layer = anchor.closest<HTMLElement>("[data-clarity-layer]");
    setHost(layer || document.body);
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const natural = popRef.current?.scrollHeight || 280;
      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = below < natural && above > below;
      const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
      setPos(
        up
          ? { bottom: vh - r.top + GAP, left, maxHeight: Math.min(420, Math.max(120, above)), up }
          : { top: r.bottom + GAP, left, maxHeight: Math.min(420, Math.max(120, below)), up },
      );
    };
    place();
    // 首帧量到真实高度后再排一次
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !host) return null;
  const inLayer = host !== document.body;
  const style: CSSProperties = {
    position: inLayer ? "absolute" : "fixed",
    zIndex: inLayer ? 5 : 1000,
    width,
    left: pos?.left ?? -9999,
    top: pos?.top,
    bottom: pos?.bottom,
    maxHeight: pos?.maxHeight,
    visibility: pos ? "visible" : "hidden",
  };
  return createPortal(
    <div ref={popRef} className={`nv-float ${className}`} data-up={pos?.up || undefined} style={style} role={role} aria-label={label}>
      {children}
    </div>,
    host,
  );
}
