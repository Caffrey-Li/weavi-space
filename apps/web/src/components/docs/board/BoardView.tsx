"use client";

import "./asset-path";
import { useRef } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useToast } from "@/components/ui/Toast";

const BoardCanvas = dynamic(() => import("./BoardCanvas"), { ssr: false, loading: () => <div className="nv-board-loading">正在打开画布…</div> });

/** 文档 · 画布查看：只读，可以平移、缩放，导出 PNG / SVG */
export function BoardView({ scene, title }: { scene: string; title: string }) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const toast = useToast();

  async function exportAs(kind: "png" | "svg") {
    const a = api.current;
    if (!a) return;
    try {
      const { exportToBlob, exportToSvg } = await import("@excalidraw/excalidraw");
      const elements = a.getSceneElements();
      if (!elements.length) return toast.error("画布是空的");
      const appState = { ...a.getAppState(), exportBackground: true, exportWithDarkMode: false };
      const files = a.getFiles();
      const blob =
        kind === "png"
          ? await exportToBlob({ elements, appState, files, mimeType: "image/png", exportPadding: 24 })
          : new Blob([(await exportToSvg({ elements, appState, files, exportPadding: 24 })).outerHTML], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title || "画布"}.${kind}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("导出失败");
    }
  }

  return (
    <div className="nv-board-view">
      <div className="nv-board-view-tools">
        <span>只读查看 · 拖动平移，滚轮缩放</span>
        <button type="button" className="btn-secondary nv-head-btn" onClick={() => void exportAs("png")}>
          <Download size={14} aria-hidden="true" />
          导出 PNG
        </button>
        <button type="button" className="btn-secondary nv-head-btn" onClick={() => void exportAs("svg")}>
          导出 SVG
        </button>
      </div>
      <BoardCanvas scene={scene} readOnly onApi={(x) => (api.current = x)} />
    </div>
  );
}
