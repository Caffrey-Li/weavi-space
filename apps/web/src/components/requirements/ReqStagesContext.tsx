"use client";

import { createContext, useContext, useMemo } from "react";
import { REQ_BOARD_COLUMNS } from "@/lib/constants";
import { visibleStatusOptions } from "@/lib/req-stages-shared";

/** 需求阶段配置（Figma 52）：停用的阶段由布局下发，看板列 / 状态菜单 / 状态抽屉统一从这里取 */
const Ctx = createContext<string[]>([]);

export function ReqStagesProvider({ hidden, children }: { hidden: string[]; children: React.ReactNode }) {
  return <Ctx.Provider value={hidden}>{children}</Ctx.Provider>;
}

export function useHiddenStatuses() {
  return useContext(Ctx);
}

/** 启用中的状态选项（含已取消） */
export function useReqStatusOptions() {
  const hidden = useContext(Ctx);
  return useMemo(() => visibleStatusOptions(hidden), [hidden]);
}

/** 看板列：启用中的、非取消的状态 */
export function useReqBoardColumns() {
  const hidden = useContext(Ctx);
  return useMemo(() => REQ_BOARD_COLUMNS.filter((c) => !hidden.includes(c.key)), [hidden]);
}
