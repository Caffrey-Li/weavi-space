"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, PanelLeft } from "lucide-react";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { NAV_ICONS, iconForPath, type NavIconName } from "./navIcons";

/** 外壳把「侧栏是否收起」交给页头，收起时页头最左出现展开按钮 */
export const ShellContext = createContext<{ collapsed: boolean; toggleCollapse: () => void }>({
  collapsed: false,
  toggleCollapse: () => {},
});

export function ExpandSidebarButton() {
  const { collapsed, toggleCollapse } = useContext(ShellContext);
  if (!collapsed) return null;
  return (
    <button type="button" className="icon-button nv-expand" aria-label="展开侧栏" title="展开侧栏 [" onClick={toggleCollapse}>
      <PanelLeft size={16} />
    </button>
  );
}

export type WorkCrumb = {
  label: string;
  href?: string;
  icon?: NavIconName;
  project?: { name: string; iconUrl?: string | null };
};

/**
 * 功能区（Work Header，高 44，左右 20）：面包屑（项目 › 模块）+ 总数胶囊；右侧操作。
 * 页面自带功能区时，外壳的默认页头自动隐藏（见 globals.css .nv-main:has(.nv-workhead-bar)）。
 */
export function WorkHeader({
  crumbs,
  count,
  actions,
}: {
  crumbs: WorkCrumb[];
  count?: number;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const inProject = pathname.startsWith("/projects/");
  // 只有面包屑里都没有自带图标时，才按路径给末级补一个
  const fallbackIcon = crumbs.some((c) => c.icon || c.project) ? undefined : iconForPath(pathname);
  return (
    <header className="nv-workhead-bar">
      {inProject ? null : <ExpandSidebarButton />}
      <nav aria-label="当前位置" className="nv-crumbs">
        <ol>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const iconName = c.icon ?? (last && !c.project ? fallbackIcon : undefined);
            const Icon = iconName ? NAV_ICONS[iconName] : null;
            const inner = (
              <>
                {c.project ? <ProjectIcon name={c.project.name} src={c.project.iconUrl} size={16} /> : null}
                {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                <span>{c.label}</span>
              </>
            );
            return (
              <li key={`${c.label}-${i}`}>
                {c.href && !last ? (
                  <Link href={c.href} className="nv-crumb">
                    {inner}
                  </Link>
                ) : (
                  <span className={`nv-crumb${last ? " is-current" : ""}`} aria-current={last ? "page" : undefined}>
                    {inner}
                  </span>
                )}
                {!last ? <ChevronRight size={14} aria-hidden="true" className="nv-crumb-sep" /> : null}
              </li>
            );
          })}
        </ol>
      </nav>
      {count != null ? <span className="nv-count is-head">{count}</span> : null}
      {actions ? <div className="nv-workhead-actions">{actions}</div> : null}
    </header>
  );
}
