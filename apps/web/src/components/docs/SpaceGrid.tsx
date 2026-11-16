"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Avatar } from "@/components/ui/Avatar";

export type SpaceCard = {
  id: string;
  name: string;
  key: string;
  iconUrl?: string | null;
  desc: string;
  pages: number;
  members: { name: string; avatarUrl?: string | null }[];
  /** project：项目空间；product：产品资料空间 */
  kind?: "project" | "product";
};

const STAR_KEY = "pm-doc-space-stars";
function readStars(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(STAR_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

/** 所有空间（Figma 13）：标签（全部 / 项目空间 / 产品空间 / 加星标）+ 空间卡片；星标存在本机 */
export function SpaceGrid({ spaces, q, children }: { spaces: SpaceCard[]; q: string; children?: React.ReactNode }) {
  const [tab, setTab] = useState<"all" | "project" | "product" | "starred">("all");
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => setStars(readStars()), []);
  function toggle(id: string) {
    setStars((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        window.localStorage.setItem(STAR_KEY, JSON.stringify(next));
      } catch {
        /* 存储不可用时只在本次生效 */
      }
      return next;
    });
  }
  const starred = spaces.filter((s) => stars.includes(s.id));
  const projectSpaces = spaces.filter((s) => s.kind !== "product");
  const productSpaces = spaces.filter((s) => s.kind === "product");
  const list = tab === "starred" ? starred : tab === "project" ? projectSpaces : tab === "product" ? productSpaces : spaces;
  const tabs = [
    { key: "all" as const, label: "全部", n: spaces.length },
    { key: "project" as const, label: "项目空间", n: projectSpaces.length },
    { key: "product" as const, label: "产品空间", n: productSpaces.length },
    { key: "starred" as const, label: "加星标", n: starred.length },
  ];
  return (
    <>
      <div className="nv-toolbar">
        <nav className="route-tabs" aria-label="空间分类">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`route-tab${tab === t.key ? " is-active" : ""}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="route-tab-count">{t.n}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="nv-page-body">
        {list.length === 0 ? (
          <p className="empty-inline">
            {tab === "starred" ? "还没有加星标的空间，点卡片右上角的星标收藏常用空间。" : q ? `没有名称包含「${q}」的空间。` : "你还没有加入任何项目，所以没有可查看的空间。"}
          </p>
        ) : (
          <div className="nv-space-grid">
            {list.map((s) => {
              const on = stars.includes(s.id);
              return (
                <div key={s.id} className="nv-space-card">
                  <div className="nv-space-head">
                    <ProjectIcon name={s.name} src={s.iconUrl} size={36} />
                    <Link href={`/docs/${s.id}`} className="nv-space-title">
                      <span className="nv-space-name">{s.name}</span>
                      <span className="nv-space-key">{s.key}</span>
                    </Link>
                    <button
                      type="button"
                      className={`icon-button nv-space-star${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      aria-label={on ? `取消星标「${s.name}」` : `星标「${s.name}」`}
                      onClick={() => toggle(s.id)}
                    >
                      <Star size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <p className="nv-space-desc">{s.desc}</p>
                  <div className="nv-space-foot">
                    <span className="nv-avatar-group">
                      {s.members.slice(0, 3).map((m) => (
                        <Avatar key={m.name} name={m.name} src={m.avatarUrl} size={18} />
                      ))}
                      {s.members.length > 3 ? <span className="nv-avatar-more">+{s.members.length - 3}</span> : null}
                    </span>
                    <span className="nv-space-pages">{s.pages} 个页面</span>
                    {s.kind === "product" ? <span className="nv-tag is-purple">产品空间</span> : <span className="nv-tag is-info">项目空间</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {children}
      </div>
    </>
  );
}

/** 空间页头上的星标（与「所有空间」卡片共用本机星标） */
export function SpaceStarButton({ id, name }: { id: string; name: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(readStars().includes(id)), [id]);
  function toggle() {
    const cur = readStars();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    try {
      window.localStorage.setItem(STAR_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
    setOn(next.includes(id));
  }
  return (
    <button
      type="button"
      className={`icon-button nv-head-icon nv-space-star${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? `取消星标「${name}」` : `星标「${name}」`}
      title={on ? "取消星标" : "加星标"}
      onClick={toggle}
    >
      <Star size={16} aria-hidden="true" />
    </button>
  );
}
