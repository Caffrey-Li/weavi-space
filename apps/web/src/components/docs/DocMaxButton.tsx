"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Scan } from "lucide-react";

/**
 * T53 文档页「最大化 / 全屏」：最大化 = 文档页（含需求交付对话栏）铺满整个窗口，隐藏导航、侧栏和顶栏；
 * 全屏 = 浏览器全屏。Esc 退出（弹窗、菜单打开时 Esc 先关它们）。
 */
export function DocMaxButton() {
  const ref = useRef<HTMLSpanElement>(null);
  const [max, setMax] = useState(false);
  const [full, setFull] = useState(false);

  const page = () => ref.current?.closest(".doc-read") as HTMLElement | null;

  useEffect(() => {
    const el = ref.current?.closest(".doc-read") as HTMLElement | null;
    if (!el) return;
    if (max) el.setAttribute("data-max", "");
    else el.removeAttribute("data-max");
    document.documentElement.classList.toggle("nv-doc-maxed", max);
    return () => {
      el.removeAttribute("data-max");
      document.documentElement.classList.remove("nv-doc-maxed");
    };
  }, [max]);

  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement;
      setFull(on);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.fullscreenElement) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      setMax(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        setMax(true);
        await page()?.requestFullscreen();
      }
    } catch {
      /* 浏览器不允许全屏：保持最大化 */
    }
  };

  return (
    <span ref={ref} className="doc-max-btns">
      <button type="button" className="icon-button" aria-pressed={max} onClick={() => setMax((v) => !v)} aria-label={max ? "退出最大化" : "最大化"} title={max ? "退出最大化（Esc）" : "最大化：铺满窗口"}>
        {max ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
      </button>
      <button type="button" className="icon-button" aria-pressed={full} onClick={() => void toggleFull()} aria-label={full ? "退出全屏" : "全屏"} title={full ? "退出全屏（Esc）" : "全屏"}>
        <Scan size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
