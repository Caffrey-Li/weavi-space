"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ListChecks, Sparkle, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

export const AI_CHATS_CHANGED = "pm-ai-chats-changed";
/** 任务状态变了（确认、停止）时通知侧栏刷新「等我确认」的数字 */
export const AI_TASKS_CHANGED = "pm-ai-tasks-changed";

/** AI 侧栏：任务（等我确认的数字）、自动化规则、最近对话（存在服务端，按账号）。Figma「81 T27 二期」103 / 104 */
export function AiNav({ onNavigate }: { onNavigate: () => void }) {
  const [chats, setChats] = useState<{ id: string; title: string }[]>([]);
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = pathname === "/ai" ? sp.get("c") : null;
  const [open, setOpen] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const tab = pathname.startsWith("/ai/tasks") ? (sp.get("tab") === "rules" ? "rules" : "tasks") : null;
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/ai/agent/waiting", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { waiting: 0 }))
        .then((d) => alive && setWaiting(Number(d.waiting) || 0))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener(AI_TASKS_CHANGED, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(AI_TASKS_CHANGED, load);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/ai/conversations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { conversations: [] }))
        .then((d) => alive && setChats(d.conversations || []))
        .catch(() => undefined);
    void load();
    window.addEventListener(AI_CHATS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(AI_CHATS_CHANGED, load);
    };
  }, []);
  return (
    <>
    <div className="nv-nav-group">
      <div className="nv-nav-list">
        <Link href="/ai/tasks" className={`nv-nav-item${tab === "tasks" ? " is-active" : ""}`} aria-current={tab === "tasks" ? "page" : undefined} onClick={onNavigate}>
          <ListChecks size={16} aria-hidden="true" />
          <span className="nv-nav-label">任务</span>
          {waiting ? (
            <span className="nv-nav-count" aria-label={`${waiting} 个等我确认`}>
              {waiting}
            </span>
          ) : null}
        </Link>
        <Link href="/ai/tasks?tab=rules" className={`nv-nav-item${tab === "rules" ? " is-active" : ""}`} aria-current={tab === "rules" ? "page" : undefined} onClick={onNavigate}>
          <Workflow size={16} aria-hidden="true" />
          <span className="nv-nav-label">自动化规则</span>
        </Link>
      </div>
    </div>
    <div className="nv-nav-group">
      <div className="nv-nav-group-head">
        <button type="button" className="nv-nav-group-label" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          最近对话
          <ChevronDown size={12} aria-hidden="true" className="nv-caret" />
        </button>
      </div>
      {open && chats.length ? (
        <div className="nv-nav-list">
          {chats.map((c) => (
            <Link
              key={c.id}
              href={`/ai?c=${c.id}`}
              className={`nv-nav-item${c.id === current ? " is-active" : ""}`}
              aria-current={c.id === current ? "page" : undefined}
              onClick={onNavigate}
              title={c.title}
            >
              <Sparkle size={16} aria-hidden="true" />
              <span className="nv-nav-label">{c.title}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
    </>
  );
}
