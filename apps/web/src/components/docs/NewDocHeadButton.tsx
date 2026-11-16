"use client";

import { Plus } from "lucide-react";
import { openNewDoc } from "./NewDocDialog";

/** 所有空间页头「新建文档」：打开新建文档弹窗（层级 / 所属 / 类型） */
export function NewDocHeadButton() {
  return (
    <button type="button" className="btn-primary nv-head-btn" onClick={() => openNewDoc()}>
      <Plus size={14} aria-hidden="true" />
      新建文档
    </button>
  );
}
