"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { isLatestGeneration, visualPhase, type OverlayPhase } from "./layerGuard";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function cssTimeMs(varName: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  // 生产构建的 CSS 压缩会把 4000ms 写成 4s，两种单位都要认
  return /\ds$/.test(raw) ? n * 1000 : n;
}

export function listFocusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.closest("[inert], [aria-hidden='true']")) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export function focusInitial(root: HTMLElement | null) {
  if (!root) return;
  const preferred = root.querySelector<HTMLElement>("[data-initial-focus]");
  const target = preferred ?? listFocusable(root)[0];
  target?.focus({ preventScroll: true });
}

export function trapTab(event: KeyboardEvent, root: HTMLElement) {
  if (event.key !== "Tab") return;
  const items = listFocusable(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

let lockCount = 0;
let previousOverflow = "";

export function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.body.style.overflow = previousOverflow;
  };
}

export function useOverlayPhase(
  open: boolean,
  timing: { enterVar: string; exitVar: string },
) {
  const [phase, setPhase] = useState<OverlayPhase>(open ? "open" : "closed");
  const generation = useRef(0);
  const timer = useRef<number | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const phaseRef = useRef(phase);
  const wasOpen = useRef(false);
  const openRef = useRef(open);
  phaseRef.current = phase;

  if (typeof document !== "undefined" && open && !wasOpen.current) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest("[data-clarity-layer]")) {
      trigger.current = active;
    }
  }
  wasOpen.current = open;

  useLayoutEffect(() => {
    const ticket = ++generation.current;
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const previous = openRef.current;
    openRef.current = open;

    if (open) {
      const enter = cssTimeMs(timing.enterVar, 180);
      if (enter <= 0 || phaseRef.current === "closing") {
        setPhase("open");
        return;
      }
      if (phaseRef.current === "open") return;
      setPhase("opening");
      const toOpen = () => {
        if (!isLatestGeneration(ticket, generation.current)) return;
        setPhase("open");
      };
      const frame = window.requestAnimationFrame(toOpen);
      // 后台标签页会暂停 requestAnimationFrame：加一个定时兜底，保证弹窗一定会出现
      const fallback = window.setTimeout(toOpen, 50);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(fallback);
      };
    }

    if (previous) {
      const returnTarget = trigger.current;
      if (returnTarget?.isConnected && !returnTarget.closest("[data-clarity-layer]")) {
        returnTarget.focus();
      }
    }
    if (phaseRef.current === "closed") return;

    const exit = cssTimeMs(timing.exitVar, 120);
    if (exit <= 0) {
      setPhase("closed");
      return;
    }
    setPhase("closing");
    timer.current = window.setTimeout(() => {
      if (!isLatestGeneration(ticket, generation.current)) return;
      setPhase("closed");
    }, exit);
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [open, timing.enterVar, timing.exitVar]);

  return { phase: visualPhase(open, phase) };
}
