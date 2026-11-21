"use client";

import { useReqStatusLabels } from "@/components/requirements/ReqStagesContext";

/** 需求状态文字：企业改过显示名称时用企业的名称（T41） */
export function ReqStatusText({ statusKey, fallback }: { statusKey: string; fallback: string }) {
  const labels = useReqStatusLabels();
  return <>{labels[statusKey] || fallback}</>;
}
