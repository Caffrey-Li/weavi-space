"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Sparkles, X } from "lucide-react";
import type { AssistantReply } from "@/lib/assistant";

type Msg = { id: number; role: "user" | "assistant"; text?: string; reply?: AssistantReply; error?: boolean };

const SUGGESTIONS = ["帮我整理看板上的需求，按当前状态分组", "哪些需求已经逾期？", "我的待办有哪些？", "各项目进度怎么样？"];

/**
 * 看板右侧 AI 助手（设计稿「需求看板 · AI 助手示例」）。
 * 只读：回答基于当前看板范围（所选项目或全部进行中项目）的真实数据，不会修改任何内容。
 */
export function AssistantPanel({
  projectId,
  onClose,
  variant = "panel",
}: {
  projectId?: string;
  onClose?: () => void;
  /** panel：看板右侧面板；page：AI 入口的整页对话（居中 760） */
  variant?: "panel" | "page";
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: ++seq.current, role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, projectId: projectId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "暂时无法回答");
      setMessages((m) => [...m, { id: ++seq.current, role: "assistant", reply: data as AssistantReply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: ++seq.current, role: "assistant", error: true, text: e instanceof Error ? e.message : "网络异常，请稍后再试" },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <aside className={`assistant${variant === "page" ? " is-page" : ""}`} aria-label="AI 助手">
      <header className="assistant-head">
        <Sparkles size={16} aria-hidden="true" className="assistant-icon" />
        <span className="assistant-title">AI 助手</span>
        <span className="assistant-tag">只读，不会修改数据</span>
        {onClose ? (
          <button type="button" className="icon-button ml-auto" aria-label="关闭 AI 助手" onClick={onClose}>
            <X size={16} />
          </button>
        ) : (
          <span className="assistant-scope ml-auto">范围：全部进行中项目</span>
        )}
      </header>

      <div ref={listRef} className="assistant-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <p>可以问我看板上需求的状态、逾期和负责人情况。回答只基于当前看板范围的数据。</p>
            <div className="assistant-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="assistant-chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="assistant-q">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className={`assistant-a${m.error ? " is-error" : ""}`}>
              {m.reply ? (
                <>
                  <p className="assistant-a-label">
                    {m.reply.source === "ai" ? "AI 回复" : "数据汇总"} · {m.reply.scope}
                  </p>
                  {m.reply.text ? <p className="assistant-a-text">{m.reply.text}</p> : null}
                  {(m.reply.sections || []).map((s) => (
                    <div key={s.title} className="assistant-section">
                      <p className="assistant-section-title">{s.title}</p>
                      <ul>
                        {s.items.map((it) => (
                          <li key={it.code}>
                            <Link href={it.href} className="assistant-link" title={it.title}>
                              {it.code} {it.title}
                            </Link>
                            {it.note ? <span className="assistant-note">{it.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                      {s.more ? <p className="assistant-note">另有 {s.more} 项</p> : null}
                    </div>
                  ))}
                </>
              ) : (
                <p className="assistant-a-text">{m.text}</p>
              )}
            </div>
          ),
        )}
        {busy ? (
          <p className="assistant-a-label" role="status">
            <span className="spinner spinner-delayed" aria-hidden="true" /> 正在整理…
          </p>
        ) : null}
      </div>

      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={3}
          maxLength={500}
          placeholder="询问需求、项目或进展…"
          aria-label="向 AI 助手提问，回车发送，Shift+回车换行"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(input);
            }
            if (e.key === "Escape") onClose?.();
          }}
        />
        <button type="submit" className="assistant-send" aria-label="发送" disabled={!input.trim() || busy}>
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}
