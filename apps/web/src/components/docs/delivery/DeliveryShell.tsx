"use client";

import { ChevronLeft, ListChecks } from "lucide-react";
import { DeliveryPanel } from "./DeliveryPanel";
import { LiveDocSwitch } from "./LiveDoc";
import { setPanelMode, usePanelCover, usePanelMode, type PanelMode } from "./panel-mode";

/** 页头「需求交付」按钮：打开 / 收起右侧交付面板 */
export function DeliveryToggle({ defaultMode }: { defaultMode: PanelMode }) {
  const mode = usePanelMode(defaultMode);
  const open = mode !== "closed";
  return (
    <button type="button" className={`btn-secondary nv-head-btn nv-dl-toggle${open ? " is-on" : ""}`} aria-pressed={open} onClick={() => setPanelMode(open ? "closed" : "open")}>
      <ListChecks size={14} aria-hidden="true" />
      需求交付
    </button>
  );
}

/** 文档页正文 + 交付面板：收起时正文照常；默认时右侧 360 宽；展开时面板铺满主信息区，正文暂时隐藏 */
export function DeliveryShell({ pageId, spaceId, defaultMode, children }: { pageId: string; spaceId: string; defaultMode: PanelMode; children: React.ReactNode }) {
  const mode = usePanelMode(defaultMode);
  const cover = usePanelCover();
  return (
    <div className="nv-dl-split" data-mode={mode === "wide" && !cover ? "open" : mode}>
      <div className="nv-dl-main">
        <LiveDocSwitch pageId={pageId}>{children}</LiveDocSwitch>
      </div>
      {mode !== "closed" ? (
        <DeliveryPanel pageId={pageId} spaceId={spaceId} mode={mode} />
      ) : (
        <button type="button" className="nv-dl-reopen" onClick={() => setPanelMode("open")} aria-label="展开需求交付面板" title="展开需求交付">
          <ChevronLeft size={14} aria-hidden="true" />
          需求交付
        </button>
      )}
    </div>
  );
}
