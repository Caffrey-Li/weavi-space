"use client";

import Link from "next/link";
import { Package, Columns3, FileText, Settings2, Sparkle, Users, type LucideIcon } from "lucide-react";
import { SECTION_LABEL, type NavSection } from "@/lib/nav-scope";

export const RAIL_ICONS: Record<NavSection, LucideIcon> = {
  work: Columns3,
  product: Package,
  docs: FileText,
  ai: Sparkle,
  org: Users,
  system: Settings2,
};

/**
 * 图标栏（60）：一级入口。工作 / 产品 / 文档 / AI，分隔线，组织 / 设置。账号在「设置 · 账号」里。
 */
export function AppRail({
  section,
  sections,
}: {
  section: NavSection;
  sections: { key: NavSection; href: string }[];
}) {
  const top = sections.filter((s) => s.key === "work" || s.key === "product" || s.key === "docs" || s.key === "ai");
  const mid = sections.filter((s) => s.key === "org" || s.key === "system");
  const item = (s: { key: NavSection; href: string }) => {
    const Icon = RAIL_ICONS[s.key];
    const active = s.key === section;
    return (
      <Link
        key={s.key}
        href={s.href}
        className={`nv-rail-item${active ? " is-active" : ""}`}
        aria-current={active ? "true" : undefined}
      >
        <span className="nv-rail-icon">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="nv-rail-label">{SECTION_LABEL[s.key]}</span>
      </Link>
    );
  };
  return (
    <nav className="nv-rail" aria-label="模块">
      {top.map(item)}
      {mid.length ? <span className="nv-rail-sep" aria-hidden="true" /> : null}
      {mid.map(item)}
    </nav>
  );
}
