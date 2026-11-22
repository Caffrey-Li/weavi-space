"use client";

import { createContext, useContext, useMemo } from "react";
import { REQ_BOARD_COLUMNS, REQ_STATUS_OPTIONS } from "@/lib/constants";

/**
 * 研发流程（Figma 52 阶段管理 + T41 企业 / 项目流程）：布局下发本人企业的流程（停用状态、显示名称）
 * 和与之不同的项目；看板列 / 状态菜单 / 状态抽屉 / 状态标签统一从这里取。传 projectId 时按该项目。
 */
type FlowInfo = { hidden: string[]; labels: Record<string, string>; reviewRequired?: boolean; mode?: "kanban" | "scrum" | "phase"; designStage?: boolean; gates?: string[] };
export type ClientFlows = {
  base: FlowInfo;
  projects: Record<string, FlowInfo>;
};
const EMPTY: ClientFlows = { base: { hidden: [], labels: {} }, projects: {} };
const Ctx = createContext<ClientFlows>(EMPTY);

export function ReqStagesProvider({ flows, children }: { flows?: ClientFlows; children: React.ReactNode }) {
  return <Ctx.Provider value={flows || EMPTY}>{children}</Ctx.Provider>;
}

/** 研发模式（T43）：看板 / Scrum 迭代 / 阶段式 */
export function useFlowMode(projectId?: string | null) {
  const f = useContext(Ctx);
  return (projectId && f.projects[projectId]?.mode) || f.base.mode || "kanban";
}

/** 停用的状态（projectId 为空 = 本人企业的默认流程） */
export function useHiddenStatuses(projectId?: string | null) {
  const f = useContext(Ctx);
  return (projectId && f.projects[projectId]?.hidden) || f.base.hidden;
}

/** 状态显示名称（企业可改名；传 projectId 时按项目所属企业）；没有 Provider 时就是默认名 */
export function useReqStatusLabels(projectId?: string | null) {
  const f = useContext(Ctx);
  return (projectId && f.projects[projectId]?.labels) || f.base.labels;
}

/** 启用中的状态选项（含已取消），名称按企业配置 */
export function useReqStatusOptions(projectId?: string | null) {
  const hidden = useHiddenStatuses(projectId);
  const labels = useReqStatusLabels(projectId);
  return useMemo(() => REQ_STATUS_OPTIONS.filter((s) => !hidden.includes(s.key)).map((s) => (labels[s.key] ? { ...s, label: labels[s.key] } : s)), [hidden, labels]);
}

/** 看板列：启用中的、非取消的状态 */
export function useReqBoardColumns(projectId?: string | null) {
  const hidden = useHiddenStatuses(projectId);
  const labels = useReqStatusLabels(projectId);
  return useMemo(() => REQ_BOARD_COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => (labels[c.key] ? { ...c, label: labels[c.key] } : c)), [hidden, labels]);
}

/** 按行取状态选项（跨项目的列表：每行按自己的项目流程过滤） */
export function useStatusOptionsFor() {
  const f = useContext(Ctx);
  const base = useReqStatusOptions();
  return useMemo(() => {
    const memo = new Map<string, typeof base>();
    return (projectId?: string | null) => {
      const pf = projectId ? f.projects[projectId] : undefined;
      if (!pf) return base;
      if (!memo.has(projectId!)) memo.set(projectId!, REQ_STATUS_OPTIONS.filter((s) => !pf.hidden.includes(s.key)).map((s) => (pf.labels[s.key] ? { ...s, label: pf.labels[s.key] } : s)));
      return memo.get(projectId!)!;
    };
  }, [f, base]);
}
