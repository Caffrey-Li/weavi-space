"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pagination } from "@/components/ui/Pagination";
import { fmtDate } from "@/lib/utils";

type N = { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };

export function NotificationsList() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [data, setData] = useState<{ items: N[]; total: number; unread: number } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/notifications?page=${page}&size=20${unreadOnly ? "&unread=1" : ""}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [page, unreadOnly]);
  useEffect(() => {
    void load();
  }, [load]);
  async function mark(body: object) {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    void load();
  }
  return (
    <div className="nv-set">
      <header className="nv-set-title">
        <h1>消息通知</h1>
        <p>指派给你的需求和 Bug、你创建的需求状态变化、项目里的新需求、上线计划变化都会通知你。想同时推到飞书，到「设置 · 飞书机器人」订阅。</p>
      </header>
      <div className="flex items-center gap-3">
        <div className="seg" role="group" aria-label="筛选">
          <button type="button" className="seg-btn" aria-pressed={!unreadOnly} onClick={() => { setUnreadOnly(false); setPage(1); }}>
            全部
          </button>
          <button type="button" className="seg-btn" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly(true); setPage(1); }}>
            未读 {data?.unread ?? ""}
          </button>
        </div>
        {data?.unread ? (
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => void mark({ all: true })}>
            全部标为已读
          </button>
        ) : null}
      </div>
      <ul className="nv-models-list mt-3" aria-label="通知列表">
        {data && data.items.length === 0 ? <li className="nv-models-item nv-ai-note">没有通知。</li> : null}
        {(data?.items || []).map((n) => (
          <li key={n.id} className={`nv-models-item${n.readAt ? "" : " is-unread"}`}>
            <div className="nv-models-item-main">
              {n.readAt ? null : <span className="nv-tag is-info mr-1">未读</span>}
              {n.href ? (
                <Link href={n.href} className="text-link" onClick={() => !n.readAt && void mark({ ids: [n.id] })}>
                  <b>{n.title}</b>
                </Link>
              ) : (
                <b>{n.title}</b>
              )}
              {n.body ? <p className="whitespace-pre-line">{n.body}</p> : null}
            </div>
            <span className="nv-ai-note shrink-0">{fmtDate(n.createdAt)}</span>
          </li>
        ))}
      </ul>
      {data && data.total > 20 ? <Pagination total={data.total} page={page} pageSize={20} onPageChange={setPage} /> : null}
    </div>
  );
}
