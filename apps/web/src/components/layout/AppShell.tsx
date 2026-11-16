"use client";
import { NotificationBell } from "./NotificationBell";

import { ReqStagesProvider } from "@/components/requirements/ReqStagesContext";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Info, Menu, MoreHorizontal, PanelLeft, Search } from "lucide-react";
import { Sidebar, type NavCounts, type NavProject } from "./Sidebar";
import { AppRail } from "./AppRail";
import { CrumbsContext, Crumbs, type Crumb, type NavOverride } from "./PageContext";
import {
  PROJECT_TABS,
  SECTION_HOME,
  projectIdFromPath,
  projectTabFor,
  scopeFromPath,
  sectionFromPath,
  type NavSection,
} from "@/lib/nav-scope";
import { ToastProvider } from "@/components/ui/Toast";
import { registerLabels } from "@/lib/constants";
import { ConfirmProvider } from "@/components/ui/Confirm";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { BrandGlyph } from "@/components/ui/BrandLogo";
import { ShellContext } from "./WorkHeader";
import { HelpPanel } from "./HelpPanel";
import { NAV_ICONS, iconForPath } from "./navIcons";
import type { ProductNavData } from "@/components/products/ProductNav";

/** 页面没有声明面包屑时，按路径给出默认位置 */
const DEFAULT_CRUMBS: { prefix: string; label: string; exact?: boolean }[] = [
  { prefix: "/", label: "工作台", exact: true },
  { prefix: "/my/requirements", label: "我的待办" },
  { prefix: "/my/bugs", label: "我的 Bug" },
  { prefix: "/requirements", label: "需求池" },
  { prefix: "/projects", label: "项目" },
  { prefix: "/board", label: "看板" },
  { prefix: "/releases", label: "发版" },
  { prefix: "/bugs", label: "Bug" },
  { prefix: "/leadership", label: "进展总览" },
  { prefix: "/members", label: "成员管理" },
  { prefix: "/permissions", label: "角色权限" },
  { prefix: "/settings", label: "账号管理" },
  { prefix: "/ai", label: "AI 助手" },
  { prefix: "/docs", label: "所有空间" },
  { prefix: "/system/appearance", label: "外观" },
  { prefix: "/system/itr", label: "排期表同步" },
];

function fallbackCrumbs(pathname: string): Crumb[] {
  const hit = DEFAULT_CRUMBS.find((c) =>
    c.exact ? pathname === c.prefix : pathname === c.prefix || pathname.startsWith(c.prefix + "/"),
  );
  return hit ? [{ label: hit.label }] : [];
}

const COLLAPSE_KEY = "pm-nav-collapsed";

/** 全局栏中间的需求搜索：只搜需求标题，回车进入需求池（在项目里时进入该项目需求池） */
function RequirementSearch({ project }: { project?: NavProject }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  return (
    <form
      role="search"
      className="nv-gsearch"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        const target = project ? `/projects/${project.id}/requirements` : "/requirements";
        router.push(q ? `${target}?q=${encodeURIComponent(q)}` : target);
      }}
    >
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索需求标题，回车在需求池查看结果"
        aria-label={project ? `在「${project.name}」需求池中搜索标题` : "搜索需求标题，回车在需求池查看结果"}
      />
    </form>
  );
}

/** 通用小浮层：点外部 / Esc 关闭 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** 项目页头「⋯」：项目相关的快捷入口 */
function ProjectMoreMenu({ project }: { project: NavProject }) {
  const { open, setOpen, ref } = usePopover();
  const menuId = useId();
  return (
    <div className="nv-project-switch-wrap" ref={ref}>
      <button
        type="button"
        className="icon-button nv-project-more"
        aria-label={`「${project.name}」项目操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="nv-menu nv-project-menu">
          <Link role="menuitem" href={`/projects/${project.id}`} className="nv-menu-item">
            项目概览
          </Link>
          <Link role="menuitem" href={`/projects/${project.id}/members`} className="nv-menu-item">
            项目成员
          </Link>
          <Link role="menuitem" href={`/docs/${project.id}`} className="nv-menu-item">
            项目文档
          </Link>
          <button
            type="button"
            role="menuitem"
            className="nv-menu-item"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/projects/${project.id}`);
              setOpen(false);
            }}
          >
            复制项目链接
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 全局栏右侧「帮助」：快捷键与版本 */
function HelpMenu() {
  const { open, setOpen, ref } = usePopover();
  const id = useId();
  return (
    <div className="nv-help-wrap" ref={ref}>
      <button
        type="button"
        className="icon-button nv-help-btn"
        aria-label="帮助与快捷键"
        title="帮助与快捷键"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={16} />
      </button>
      {open ? <HelpPanel id={id} /> : null}
    </div>
  );
}

/** 项目页头（48）：项目切换 + 项目标签（下划线式，与页头等高） */
function ProjectHeader({
  project,
  projects,
  activeTab,
  expandButton,
}: {
  project: NavProject;
  projects: NavProject[];
  activeTab: string;
  expandButton: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const others = projects.filter((p) => p.id !== project.id);
  return (
    <header className="nv-project-header">
      {expandButton}
      <div className="nv-project-switch-wrap" ref={rootRef}>
        <button
          type="button"
          className="nv-project-switch"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <ProjectIcon name={project.name} src={project.iconUrl} size={20} />
          <span className="nv-project-switch-name">{project.name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open ? (
          <div id={menuId} role="menu" className="nv-menu nv-project-menu">
            <div className="nv-menu-label">切换项目</div>
            {others.map((p) => (
              <Link
                key={p.id}
                role="menuitem"
                href={`/projects/${p.id}${activeTab}`}
                className="nv-menu-item"
                onClick={() => setOpen(false)}
              >
                <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
            {others.length ? <div className="nv-menu-sep" role="separator" /> : null}
            <Link role="menuitem" href="/projects" className="nv-menu-item" onClick={() => setOpen(false)}>
              全部项目
            </Link>
          </div>
        ) : null}
      </div>
      <ProjectMoreMenu project={project} />
      <span className="nv-project-header-sep" aria-hidden="true" />
      <nav className="nv-tabs" aria-label="项目内导航">
        {PROJECT_TABS.map((t) => {
          const active = t.sub === activeTab;
          return (
            <Link
              key={t.sub}
              href={`/projects/${project.id}${t.sub}`}
              className={`nv-tab${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/**
 * Nova B 版应用框架（Plane 层级）：
 * 顶部 40 全局栏（工作区 · 需求搜索）· 左侧 60 图标栏（账号在「设置 · 账号」） · 右侧圆角容器（240 二级侧栏 + 主信息区）。
 * ≥1024：侧栏可收起（快捷键 [）；<1024：图标栏隐藏，侧栏变抽屉，由全局栏菜单按钮打开。
 */
export function AppShell({
  counts,
  projects = [],
  canCreate,
  canCreateBug,
  canManageProducts,
  productNav,
  system,
  canManageOrg = false,
  roleLabel,
  isAdmin,
  isEntAdmin,
  labels,
  hiddenStatuses = [],
  children,
}: {
  /** 需求阶段配置里停用的阶段（Figma 52） */
  hiddenStatuses?: string[];
  roleLabel?: string;
  /** 数据库里的角色 / 岗位名称（自定义的也在内），渲染前登记给 roleLabel() / jobRoleLabel() */
  labels?: { roles: { key: string; name: string }[]; positions: { key: string; name: string }[] };
  isAdmin?: boolean;
  /** 企业超管：能看到「登录管理」 */
  isEntAdmin?: boolean;
  counts?: NavCounts;
  projects?: NavProject[];
  canCreate?: boolean;
  canCreateBug?: boolean;
  canManageProducts?: boolean;
  productNav?: ProductNavData;
  /** 「设置 · 常规」：系统名称、标志、每周起始日 */
  system?: { name: string; logo: string; weekStart: string };
  canManageOrg?: boolean;
  children: React.ReactNode;
}) {
  if (labels) registerLabels(labels);
  // 每周起始日写到 <html data-week-start>，日期选择器据此排星期
  useEffect(() => {
    document.documentElement.dataset.weekStart = system?.weekStart === "0" ? "0" : "1";
  }, [system?.weekStart]);
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const [navOverride, setNav] = useState<NavOverride | null>(null);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const ctx = useMemo(() => ({ setCrumbs, setNav }), []);
  const section = sectionFromPath(pathname);
  const scope = navOverride?.scope ?? scopeFromPath(pathname);
  const projectId = scope === "project" ? (navOverride ? navOverride.projectId ?? null : projectIdFromPath(pathname)) : null;
  const project = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
  const pageCrumbs = crumbs ?? fallbackCrumbs(pathname);
  const pageIconName = iconForPath(pathname);
  const PageIcon = pageIconName ? NAV_ICONS[pageIconName] : null;

  const sections = useMemo(() => {
    const keys: NavSection[] = ["work", "product", "docs", "ai", ...(canManageOrg ? (["org"] as const) : []), "system"];
    return keys.map((key) => ({ key, href: SECTION_HOME[key] }));
  }, [canManageOrg]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* 无存储时默认展开 */
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* 忽略 */
      }
      return !v;
    });
  }, []);

  // 快捷键 [ 收起 / 展开侧栏（输入框聚焦时不触发）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[aria-modal='true']")) return;
      if (window.matchMedia("(max-width: 1023px)").matches) return;
      toggleCollapse();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleCollapse]);

  const shellCtx = useMemo(() => ({ collapsed, toggleCollapse }), [collapsed, toggleCollapse]);

  const expandButton = collapsed ? (
    <button type="button" className="icon-button nv-expand" aria-label="展开侧栏" title="展开侧栏 [" onClick={toggleCollapse}>
      <PanelLeft size={16} />
    </button>
  ) : null;

  return (
    <ToastProvider>
      <ReqStagesProvider hidden={hiddenStatuses}>
      <ConfirmProvider>
        <CrumbsContext.Provider value={ctx}>
          <ShellContext.Provider value={shellCtx}>
          <div className="nv-app">
            <header className="nv-globalbar">
              <button
                type="button"
                className="icon-button nv-menu-toggle"
                aria-label="打开导航"
                aria-expanded={navOpen}
                aria-controls="app-nav"
                onClick={() => setNavOpen(true)}
              >
                <Menu size={18} />
              </button>
              <Link href="/" className="nv-workspace" aria-label={`${system?.name || "小围空间"} 工作台`}>
                <span className={`nv-workspace-logo${system?.logo ? " has-img" : ""}`} aria-hidden="true">
                  {system?.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={system.logo} alt="" />
                  ) : (
                    <BrandGlyph size={14} />
                  )}
                </span>
                <span className="nv-workspace-name">{system?.name || "小围空间"}</span>
              </Link>
              <RequirementSearch project={project ?? undefined} />
              <div className="nv-globalbar-right">
                <NotificationBell />
                <HelpMenu />
              </div>
            </header>
            <div className="nv-body">
              <AppRail section={section} sections={sections} />
              <div className="nv-container">
                <Sidebar
                  section={section}
                  sections={sections}
                  counts={counts}
                  projects={projects}
                  canCreate={canCreate}
                  canCreateBug={canCreateBug}
                  canManageProducts={canManageProducts}
                  productNav={productNav}
                  systemName={system?.name}
                  systemLogo={system?.logo}
                  projectId={section === "work" ? projectId : null}
                  open={navOpen}
                  collapsed={collapsed}
                  onClose={closeNav}
                  onToggleCollapse={toggleCollapse}
                  roleLabel={roleLabel}
                  isAdmin={isAdmin}
                  isEntAdmin={isEntAdmin}
                />
                <main className="nv-main" id="app-main">
                  {project ? (
                    <ProjectHeader
                      project={project}
                      projects={projects}
                      activeTab={projectTabFor(pathname)}
                      expandButton={expandButton}
                    />
                  ) : (
                    <header className="nv-pagebar">
                      {expandButton}
                      {PageIcon ? <PageIcon size={16} aria-hidden="true" className="nv-pagebar-icon" /> : null}
                      <Crumbs crumbs={pageCrumbs} />
                    </header>
                  )}
                  <div className="app-scroll">{children}</div>
                </main>
              </div>
            </div>
          </div>
          </ShellContext.Provider>
        </CrumbsContext.Provider>
      </ConfirmProvider>
      </ReqStagesProvider>
    </ToastProvider>
  );
}
