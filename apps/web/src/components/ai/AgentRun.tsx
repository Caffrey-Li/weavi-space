"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Square, X } from "lucide-react";

/** 动手模式（T27）的一次任务：步骤列表、等你确认的卡片、用量。Figma「76 T27 · 90 / 91」 */
export type AgentStepView = { id: string; seq: number; kind: string; tool: string | null; level: string | null; summary: string; status: string };
export type AgentTaskView = {
  id: string;
  status: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
  model: string;
  steps: number;
  maxSteps: number;
  tokens: number;
  result: string | null;
  error: string | null;
  pending: { name: string; args: Record<string, unknown> } | null;
  createdAt: string | null;
  finishedAt: string | null;
  stepRows: AgentStepView[];
};

const TOOL_LABEL: Record<string, string> = {
  create_requirement: "新建需求",
  update_requirement: "修改需求",
  update_requirement_status: "修改需求状态",
  comment_requirement: "评论需求",
  create_bug: "新建 Bug",
  update_bug_status: "修改 Bug 状态",
  run_skill: "执行个人能力",
};
const ARG_LABEL: Record<string, string> = {
  title: "标题",
  projectId: "项目",
  id: "对象",
  status: "状态",
  priority: "优先级",
  severity: "严重级别",
  plannedEndAt: "计划完成",
  descriptionHtml: "描述",
  bodyHtml: "内容",
  skillId: "能力",
  input: "输入",
  spaceId: "存到空间",
};
const HIDDEN = new Set(["revision", "credentialId", "model"]);
const plain = (v: unknown) => String(typeof v === "string" ? v : JSON.stringify(v)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export const ACTIVE = ["queued", "running", "waiting"];

function argRows(args: Record<string, unknown>, projects: { id: string; name: string }[]) {
  return Object.entries(args)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const text = k === "projectId" ? projects.find((p) => p.id === v)?.name || String(v) : plain(v);
      return { k: ARG_LABEL[k] || k, v: text.length > 160 ? `${text.slice(0, 160)}…` : text };
    });
}

function elapsed(t: AgentTaskView) {
  if (!t.createdAt || !t.finishedAt) return "";
  const s = Math.max(1, Math.round((new Date(t.finishedAt).getTime() - new Date(t.createdAt).getTime()) / 1000));
  return s < 60 ? `用时 ${s} 秒` : `用时 ${Math.round(s / 60)} 分钟`;
}

export function AgentRun({
  task,
  projects,
  onResolve,
  onStop,
}: {
  task: AgentTaskView;
  projects: { id: string; name: string }[];
  onResolve: (approve: boolean, note: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const active = ACTIVE.includes(task.status);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const rows = task.stepRows.filter((s) => s.kind !== "answer");
  const confirms = rows.filter((s) => s.kind === "confirm" && s.status === "approved").length;
  const showSteps = active || open;
  const pendingLevel = task.stepRows.find((s) => s.status === "waiting")?.level;

  async function act(approve: boolean) {
    setSending(true);
    try {
      await onResolve(approve, approve ? "" : note.trim());
      setRejecting(false);
      setNote("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="nv-agent">
      <div className="nv-agent-steps">
        {!active ? (
          <button type="button" className="nv-agent-sum" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {task.status === "done" ? <Check size={14} className="nv-agent-ok" aria-hidden="true" /> : <X size={14} className="nv-agent-bad" aria-hidden="true" />}
            <b>{task.status === "done" ? `已完成 ${task.steps} 步` : task.status === "cancelled" ? "已停止" : "没有做完"}</b>
            <span className="nv-agent-meta">
              {[elapsed(task), `${task.tokens.toLocaleString()} Token`, confirms ? `你确认了 ${confirms} 次` : ""].filter(Boolean).join(" · ")}
            </span>
            <span className="nv-agent-toggle">
              {open ? "收起步骤" : "展开步骤"}
              {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            </span>
          </button>
        ) : null}
        {showSteps ? (
          <ol className="nv-agent-list">
            {rows.map((s) => (
              <li key={s.id} className={`is-${s.status}`}>
                <span className="nv-agent-mark" aria-hidden="true">
                  {s.status === "done" || s.status === "approved" ? "✓" : s.status === "waiting" ? "" : "✕"}
                </span>
                <span>{s.summary}</span>
              </li>
            ))}
            {task.status === "running" || task.status === "queued" ? (
              <li className="is-running">
                <span className="nv-agent-mark" aria-hidden="true" />
                <span>{task.status === "queued" ? "排队中…" : "小围正在想下一步…"}</span>
              </li>
            ) : null}
          </ol>
        ) : null}
      </div>

      {task.status === "waiting" && task.pending ? (
        <div className="nv-agent-card" role="group" aria-label="等你确认">
          <div className="nv-agent-card-head">
            <span className="nv-agent-level">{pendingLevel === "external" ? "对外操作" : "写操作 · 可撤销"}</span>
            <b>小围想{TOOL_LABEL[task.pending.name] || task.pending.name}</b>
          </div>
          <dl className="nv-agent-args">
            {argRows(task.pending.args, projects).map((r) => (
              <div key={r.k}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
          <p className="nv-agent-hint">用你自己的权限执行。建错了可以在对应页面修改或删除。</p>
          {rejecting ? (
            <div className="nv-agent-reject">
              <input className="input" value={note} maxLength={500} placeholder="哪里不对？小围会按你的意见改（可不填）" aria-label="不同意的原因" onChange={(e) => setNote(e.target.value)} autoFocus />
              <button type="button" className="btn-secondary nv-head-btn" disabled={sending} onClick={() => void act(false)}>
                告诉小围
              </button>
              <button type="button" className="btn-ghost nv-head-btn" disabled={sending} onClick={() => setRejecting(false)}>
                返回
              </button>
            </div>
          ) : (
            <div className="nv-agent-btns">
              <button type="button" className="btn-primary nv-head-btn" disabled={sending} onClick={() => void act(true)}>
                <Check size={14} aria-hidden="true" />
                确认执行
              </button>
              <button type="button" className="btn-secondary nv-head-btn" disabled={sending} onClick={() => setRejecting(true)}>
                不同意
              </button>
              <span className="nv-agent-hint">不同意时可以写原因，小围会按你的意见改</span>
            </div>
          )}
        </div>
      ) : null}

      {active ? (
        <div className="nv-agent-foot">
          <span>
            第 {Math.max(1, task.steps)} 步 · 上限 {task.maxSteps} 步 · 已用 {task.tokens.toLocaleString()} Token · {task.model}
            {task.status === "waiting" ? " · 等你确认期间不占用模型" : ""}
          </span>
          <button type="button" className="btn-ghost nv-head-btn" onClick={() => void onStop()}>
            <Square size={12} aria-hidden="true" />
            停止
          </button>
        </div>
      ) : null}
      {task.status === "failed" && task.error ? <p className="nv-agent-error">{task.error}</p> : null}
    </div>
  );
}
