"use client";

import "./asset-path";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { boardTemplate } from "./templates";


export type BoardSceneJson = { elements?: ExcalidrawElement[]; appState?: Record<string, unknown>; files?: BinaryFiles; template?: string };

export function parseScene(json: string): BoardSceneJson {
  try {
    return JSON.parse(json || "{}") as BoardSceneJson;
  } catch {
    return {};
  }
}

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setDark(t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/**
 * Excalidraw 画布（客户端组件，页面里用 next/dynamic 关掉 SSR 引入）。
 * readOnly 时是查看模式：可以平移、缩放、导出，不能改。
 */
export default function BoardCanvas({
  scene,
  readOnly,
  onChange,
  onApi,
}: {
  scene: string;
  readOnly?: boolean;
  onChange?: (json: string) => void;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}) {
  const dark = useDark();
  const initialData = useMemo(() => {
    const s = parseScene(scene);
    let elements = (s.elements || []) as ExcalidrawElement[];
    // 新建时选了模板：第一次打开把模板图形放进来
    if (!elements.length && s.template) elements = convertToExcalidrawElements(boardTemplate(s.template));
    // 默认用规整线条和无衬线字体（流程图、架构图更清楚），用户可以在样式面板里换成手绘风
    return { elements, appState: { currentItemRoughness: 0, currentItemFontFamily: 2, currentItemRoundness: "round" as const, ...(s.appState || {}), viewModeEnabled: Boolean(readOnly) }, files: s.files || {}, scrollToContent: true };
    // 只在第一次挂载时读初始数据
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="nv-board-canvas">
      <Excalidraw
        initialData={initialData}
        langCode="zh-CN"
        theme={dark ? "dark" : "light"}
        viewModeEnabled={Boolean(readOnly)}
        excalidrawAPI={(api) => {
          onApi?.(api);
          // 打开时把内容整体放进视口
          window.setTimeout(() => api.scrollToContent(undefined, { fitToContent: true }), 50);
        }}
        validateEmbeddable={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: true, toggleTheme: false } }}
        onChange={(elements, appState, files) => {
          if (readOnly || !onChange) return;
          const used = new Set(elements.filter((e) => e.type === "image" && !e.isDeleted).map((e) => (e as { fileId?: string }).fileId));
          const keep: BinaryFiles = {};
          for (const [id, f] of Object.entries(files)) if (used.has(id)) keep[id] = f;
          onChange(
            JSON.stringify({
              type: "excalidraw",
              version: 2,
              elements: elements.filter((e) => !e.isDeleted),
              appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize ?? undefined },
              files: keep,
            }),
          );
        }}
      />
    </div>
  );
}
