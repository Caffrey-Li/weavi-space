"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";

type Status = {
  packs: { skill: string; version: string; source: "bundled" | "online"; fetchedAt: string | null }[];
  auto: boolean;
  lastCheck: { at: string; ok: boolean; error: string | null; latest: Record<string, string>; updated: string[]; wikiError?: string | null } | null;
  canManage: boolean;
  /** 只有系统超管能看到：Wiki 输出规范的私有仓库和令牌（掩码） */
  wiki: { repo: string; token: string | null } | null;
};

const when = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 个人能力页「系统内置」上方的版本条（Figma「82」98b）：当前版本、自动更新、上次检查；系统超管可以立即检查、开关自动更新 */
export function BuiltinSkillUpdates({ onUpdated }: { onUpdated: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [editToken, setEditToken] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/skills/updates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setS(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/skills/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(d.error || "操作失败");
      setS(d);
      if (body.action === "wikiToken") {
        setEditToken(false);
        setToken("");
        toast.success(body.token ? "令牌已保存，下次检查时会更新 Wiki 输出规范" : "令牌已移除");
      }
      if (body.action === "check") {
        const updated = d.lastCheck?.updated || [];
        toast.success(updated.length ? `已更新：${updated.join("；")}` : "已是最新版本");
        if (updated.length) onUpdated();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const last = s.lastCheck;
  const lastText = !last ? "还没有检查过" : last.ok ? `上次检查：${when(last.at)}，${last.updated.length ? `已更新 ${last.updated.join("；")}` : "已是最新"}` : `上次检查：${when(last.at)}，失败：${last.error}`;
  return (
    <div className="nv-skill-ver" role="status">
      <div className="nv-skill-ver-main">
        <b>系统内置：{s.packs.map((p) => `${p.skill} v${p.version}`).join(" · ")}</b>
        <span suppressHydrationWarning>
          {s.auto ? "自动更新已开启，每天从 GitHub 检查一次" : "自动更新已关闭"} · {lastText}
        </span>
      </div>
      {s.canManage ? (
        <>
          <label className="nv-switch nv-skill-ver-auto">
            <input type="checkbox" checked={s.auto} disabled={busy} onChange={(e) => void post({ action: "auto", on: e.target.checked })} />
            <span aria-hidden="true" />
            自动更新
          </label>
          <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void post({ action: "check" })}>
            {busy ? "检查中…" : "检查更新"}
          </button>
        </>
      ) : null}
      {s.wiki ? (
        <div className="nv-skill-ver-wiki">
          <span>
            Wiki 输出规范来自私有仓库 {s.wiki.repo}，
            {s.wiki.token ? `已配置只读令牌 ${s.wiki.token}，随自动更新一起检查` : "配置 GitHub 只读令牌后才能自动更新"}
            {last?.wikiError ? `（上次失败：${last.wikiError}）` : ""}
          </span>
          {editToken ? (
            <form
              className="nv-skill-ver-token"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: "wikiToken", token });
              }}
            >
              <label className="sr-only" htmlFor="wiki-skill-token">
                GitHub 令牌
              </label>
              <input id="wiki-skill-token" className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…（只需要这个仓库的 Contents 只读权限）" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !token.trim()}>
                {busy ? "验证中…" : "保存"}
              </button>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setEditToken(false)}>
                取消
              </button>
            </form>
          ) : (
            <span className="nv-skill-ver-actions">
              <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => setEditToken(true)}>
                {s.wiki.token ? "更换令牌" : "配置令牌"}
              </button>
              {s.wiki.token ? (
                <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void post({ action: "wikiToken", token: "" })}>
                  移除
                </button>
              ) : null}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
