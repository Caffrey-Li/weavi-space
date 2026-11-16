"use client";

import { createContext, useContext, useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/** 导航范围：功能栏切换的四个范围 */
export type NavScope = "me" | "project" | "global" | "team";
export type NavOverride = { scope: NavScope; projectId?: string | null };

type Ctx = {
  setCrumbs: (crumbs: Crumb[] | null) => void;
  setNav: (nav: NavOverride | null) => void;
};
export const CrumbsContext = createContext<Ctx>({ setCrumbs: () => {}, setNav: () => {} });

/**
 * 页面声明自己的位置：面包屑（显示在主信息区顶部的页头栏）
 * 以及所属范围——详情页这类路径不唯一的页面用它告诉导航「我属于哪个项目」。
 */
export function PageContext({ crumbs, scope, projectId }: { crumbs: Crumb[]; scope?: NavScope; projectId?: string | null }) {
  const { setCrumbs, setNav } = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
    return () => setCrumbs(null);
  }, [key, setCrumbs]);
  useEffect(() => {
    if (!scope) return;
    setNav({ scope, projectId: projectId ?? null });
    return () => setNav(null);
  }, [scope, projectId, setNav]);
  return null;
}

export function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  const all: Crumb[] = crumbs;
  return (
    <nav aria-label="当前位置" className="context-crumbs">
      <ol>
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={last ? "is-last" : undefined}>
              {c.href && !last ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined} title={c.label}>
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRight size={14} aria-hidden="true" className="context-sep" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
