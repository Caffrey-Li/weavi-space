"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { ACTIVE, AgentRun, type AgentTaskView } from "./AgentRun";
import { StatusChip, when } from "./AgentTasks";
import { AI_TASKS_CHANGED } from "./AiNav";
import { Markdown } from "./Markdown";

type Detail = AgentTaskView & { goal: string; source: string; trigger: string | null; conversationId: string | null; rule: { id: string; name: string } | null; hops: number };

/** 任务详情（/ai/tasks/[id]）：飞书卡片、站内通知的「去确认」打开这里；步骤和确认卡片沿用对话里的 AgentRun（Figma 90 / 91） */
export function AgentTaskDetail({ id, projects }: { id: string; projects: { id: string; name: string }[] }) {
  const toast = useToast();
  const [task, setTask] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/ai/agent/${id}`, { cache: "no-store" });
    if (r.status === 404) return setMissing(true);
    const d = await r.json().catch(() => null);
    if (d?.task) setTask(d.task);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  // 进行中每 1.5 秒刷新；等确认时不轮询（挂起不占资源）
  useEffect(() => {
    if (!task || !["queued", "running"].includes(task.status)) return;
    const t = window.setTimeout(() => void load(), 1500);
    return () => window.clearTimeout(t);
  }, [task, load]);

  async function post(path: string, body?: unknown) {
    const r = await fetch(`/api/ai/agent/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(d.error || "操作失败");
      void load();
      return;
    }
    if (d.task) setTask(d.task);
    window.dispatchEvent(new Event(AI_TASKS_CHANGED));
  }

  if (missing) return <p className="nv-skills-empty">任务不存在，或者不是你的任务。</p>;
  if (!task) return <p className="nv-skills-empty">加载中…</p>;
  return (
    <div className="nv-set nv-agt nv-agt-detail">
      <header className="nv-set-title">
        <h1>{task.goal}</h1>
        <p className="nv-agt-meta">
          <StatusChip status={task.status} />
          <span>{task.source === "rule" ? `规则「${task.rule?.name || "已删除"}」` : "对话"}</span>
          {task.trigger ? <span>{task.trigger}</span> : null}
          <span suppressHydrationWarning>{when(task.createdAt)}</span>
          {task.source === "chat" && task.conversationId ? (
            <Link href={`/ai?c=${task.conversationId}`} className="text-link">
              打开对话
            </Link>
          ) : null}
          {task.rule ? (
            <Link href="/ai/tasks?tab=rules" className="text-link">
              查看规则
            </Link>
          ) : null}
        </p>
      </header>
      <AgentRun task={task} projects={projects} onResolve={(approve, note) => post("resolve", { approve, note })} onStop={() => post("stop")} />
      {!ACTIVE.includes(task.status) && task.result ? <Markdown text={task.result} className="nv-agt-result" /> : null}
    </div>
  );
}
