"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

type N = { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 1440)} 天前`;
}

/** 顶栏铃铛：未读数（每分钟刷新）+ 最近 8 条，点开即可跳转；全部在「消息通知」页 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<N[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async (withItems: boolean) => {
    const r = await fetch(`/api/notifications?size=8`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setUnread(d.unread || 0);
    if (withItems) setItems(d.items);
  }, []);
  useEffect(() => {
    void load(false);
    const t = setInterval(() => void load(false), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  async function readAll() {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    void load(true);
  }
  async function readOne(n: N) {
    if (!n.readAt) await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [n.id] }) });
    setOpen(false);
    void load(false);
  }
  return (
    <div className="nv-help-wrap" ref={ref}>
      <button
        type="button"
        className="icon-button nv-help-btn nv-bell"
        aria-label={unread ? `消息通知，${unread} 条未读` : "消息通知"}
        title="消息通知"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load(true);
        }}
      >
        <Bell size={16} />
        {unread ? <span className="nv-bell-dot">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="nv-bell-pop" role="dialog" aria-label="消息通知">
          <div className="nv-bell-head">
            <b>消息通知</b>
            {unread ? (
              <button type="button" className="text-link" onClick={() => void readAll()}>
                全部标为已读
              </button>
            ) : null}
          </div>
          {items === null ? <p className="nv-bell-empty">正在读取…</p> : null}
          {items?.length === 0 ? <p className="nv-bell-empty">还没有通知。</p> : null}
          <ul>
            {(items || []).map((n) => (
              <li key={n.id} className={n.readAt ? "" : "is-unread"}>
                <Link href={n.href || "/notifications"} onClick={() => void readOne(n)}>
                  <span className="nv-bell-title">{n.title}</span>
                  {n.body ? <span className="nv-bell-body">{n.body}</span> : null}
                  <span className="nv-bell-time">{ago(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/notifications" className="nv-bell-all" onClick={() => setOpen(false)}>
            查看全部
          </Link>
        </div>
      ) : null}
    </div>
  );
}
