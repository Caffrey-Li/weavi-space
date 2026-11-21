"use client";

import { Suspense, useEffect, useId, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Briefcase, Bug, Building2, CalendarCheck, ChartColumn, ChevronDown, ChevronRight, Columns3, Cpu, Folder, House, Inbox, Info, KeyRound, List, MessageSquare, MonitorPlay, MoreHorizontal, Network, PanelLeft, Plug, Plus, RefreshCw, Rocket, Shield, ShieldCheck, SlidersHorizontal, Sparkles, SquarePen, Sun, Trash2, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { PROJECT_TABS, SECTION_LABEL, projectTabFor, type NavSection } from "@/lib/nav-scope";
import { inertProps } from "@/components/ui/inert";
import { NewRequirementButton } from "@/components/requirements/NewRequirementButton";
import { NewBugButton } from "@/components/bugs/NewBugButton";
import { ProductNav, ProductNavTop, productIdFromPath, type ProductNavData } from "@/components/products/ProductNav";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { focusInitial, lockScroll, trapTab, useOverlayPhase } from "@/components/ui/useOverlayPhase";
import { RAIL_ICONS } from "./AppRail";
import { DocsNav, DocsNewPageButton } from "@/components/docs/DocsNav";
import { AiNav } from "@/components/ai/AiNav";
import { HelpPanel } from "./HelpPanel";
import { NavGroup, readOpen, saveOpen } from "./NavGroup";

export type NavProject = { id: string; name: string; iconUrl?: string | null };
export type NavCounts = { myRequirements?: number; myBugs?: number; allRequirements?: number };

type Item = { label: string; href: string; Icon: LucideIcon; exact?: boolean; also?: string[]; count?: number };

const PROJECT_TAB_ICONS: Record<string, LucideIcon> = {
  "": House,
  "/requirements": List,
  "/board": Columns3,
  "/bugs": Bug,
  "/plans": CalendarCheck,
  "/releases": Rocket,
  "/members": Users,
};

function isActive(pathname: string, item: Item) {
  const hit = (h: string, exact?: boolean) => (exact ? pathname === h : pathname === h || pathname.startsWith(h + "/"));
  return hit(item.href, item.exact) || (item.also || []).some((h) => hit(h));
}

export function useNarrowNav() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return narrow;
}

function NavLink({ item, active, onNavigate }: { item: Item; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`nv-nav-item${active ? " is-active" : ""}`}
      onClick={onNavigate}
    >
      <item.Icon size={16} aria-hidden="true" />
      <span className="nv-nav-label">{item.label}</span>
      {item.count ? (
        <span className="nv-nav-count" aria-label={`${item.count} 条`}>
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

function ProjectNav({
  project,
  current,
  activeTab,
  onNavigate,
}: {
  project: NavProject;
  current: boolean;
  activeTab: string | null;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(current);
  const listId = useId();
  useEffect(() => {
    setOpen(current || readOpen(`project:${project.id}`, false));
  }, [current, project.id]);
  const base = `/projects/${project.id}`;
  return (
    <div className="nv-project">
      <div className={`nv-project-row${current && activeTab == null ? " is-active" : ""}`}>
        <Link href={base} className="nv-project-link" onClick={onNavigate} title={project.name}>
          <ProjectIcon name={project.name} src={project.iconUrl} size={20} className="nv-project-icon" />
          <span className="nv-project-name">{project.name}</span>
        </Link>
        <button
          type="button"
          className="nv-project-toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${open ? "收起" : "展开"}「${project.name}」`}
          onClick={() =>
            setOpen((v) => {
              saveOpen(`project:${project.id}`, !v);
              return !v;
            })
          }
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
        <span className="flex-1" />
        <ProjectRowMenu project={project} onNavigate={onNavigate} />
      </div>
      <div id={listId} hidden={!open} className="nv-project-sub">
        {PROJECT_TABS.map((t) => (
          <NavLink
            key={t.sub}
            item={{ label: t.label, href: `${base}${t.sub}`, Icon: PROJECT_TAB_ICONS[t.sub] }}
            active={current && activeTab === t.sub}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

/** 侧栏底部「帮助与快捷键 v2.0」 */
function SidebarHelp() {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".nv-sidebar-foot")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="nv-sidebar-foot">
      <button type="button" className="nv-sidebar-help" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}>
        <Info size={16} aria-hidden="true" />
        帮助与快捷键
      </button>
      <span className="nv-sidebar-ver">v2.0</span>
      {open ? <HelpPanel id={id} placement="up" /> : null}
    </div>
  );
}

/** 侧栏项目行的「⋯」：进入项目各页 */
function ProjectRowMenu({ project, onNavigate }: { project: NavProject; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(`[data-menu-root="${menuId}"]`)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, menuId]);
  const base = `/projects/${project.id}`;
  return (
    <div className="nv-project-more-wrap" data-menu-root={menuId}>
      <button
        type="button"
        className="nv-project-more-btn"
        aria-label={`「${project.name}」更多`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="nv-menu nv-project-row-menu">
          {[
            { label: "项目概览", href: base },
            { label: "需求池", href: `${base}/requirements` },
            { label: "项目成员", href: `${base}/members` },
            { label: "项目文档", href: `/docs/${project.id}` },
          ].map((m) => (
            <Link
              key={m.href}
              role="menuitem"
              href={m.href}
              className="nv-menu-item"
              onClick={() => {
                setOpen(false);
                onNavigate();
              }}
            >
              {m.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 二级侧栏（240）：随图标栏的一级入口切换内容。
 * ≥1024：在圆角容器左侧，可收起（完全隐藏）；<1024：变为左侧抽屉，顶部带一级入口切换。
 */
export function Sidebar({
  section,
  sections,
  counts = {},
  projects = [],
  canCreate = false,
  canCreateBug = false,
  canManageProducts = false,
  productNav,
  systemName,
  systemLogo,
  projectId,
  open,
  collapsed = false,
  onClose,
  onToggleCollapse,
  roleLabel,
  isAdmin,
  isEntAdmin,
}: {
  roleLabel?: string;
  isAdmin?: boolean;
  isEntAdmin?: boolean;
  section: NavSection;
  sections: { key: NavSection; href: string }[];
  counts?: NavCounts;
  projects?: NavProject[];
  canCreate?: boolean;
  canCreateBug?: boolean;
  canManageProducts?: boolean;
  productNav?: ProductNavData;
  systemName?: string;
  systemLogo?: string;
  projectId: string | null;
  open: boolean;
  collapsed?: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const narrow = useNarrowNav();
  const presented = narrow && open;
  const { phase } = useOverlayPhase(presented, {
    enterVar: "--clarity-duration-slow",
    exitVar: "--clarity-duration-normal",
  });

  useEffect(() => {
    onClose();
    // 导航后关闭抽屉；handler 由 AppShell 持有
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useLayoutEffect(() => {
    if (!presented) return;
    const unlock = lockScroll();
    const main = document.getElementById("app-main");
    const changed: HTMLElement[] = [];
    if (main instanceof HTMLElement && !main.hasAttribute("inert")) {
      main.setAttribute("inert", "");
      changed.push(main);
    }
    return () => {
      unlock();
      for (const el of changed) el.removeAttribute("inert");
    };
  }, [presented]);

  useLayoutEffect(() => {
    if (!presented) return;
    focusInitial(document.getElementById("app-nav"));
  }, [presented]);

  useEffect(() => {
    if (!presented) return;
    function onKeyDown(event: KeyboardEvent) {
      const root = document.getElementById("app-nav");
      if (!root) return;
      if (event.key === "Tab") {
        trapTab(event, root);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [presented, onClose]);

  const go = () => onClose();
  const links = (items: Item[]) =>
    items.map((it) => <NavLink key={it.href} item={it} active={isActive(pathname, it)} onNavigate={go} />);

  let body: React.ReactNode = null;
  let create: React.ReactNode = null;

  if (section === "work") {
    const tab = projectId ? projectTabFor(pathname) : null;
    // 在项目里时，全局的「需求池 / 看板…」不高亮，高亮交给项目子导航
    const inProject = Boolean(projectId);
    create =
      canCreate || canCreateBug ? (
        <div className="nv-sidebar-create-row">
          {canCreate ? (
            <NewRequirementButton
              key={projectId || "none"}
              className="btn-secondary nv-sidebar-create"
              defaultProjectId={projectId || undefined}
              icon={<SquarePen size={16} aria-hidden="true" />}
            />
          ) : null}
          {canCreateBug ? (
            <NewBugButton
              key={`bug-${projectId || "none"}`}
              defaultProjectId={projectId || undefined}
              label="新建 Bug"
              ariaLabel="新建 Bug"
              title="新建 Bug"
              iconNode={<Bug size={16} aria-hidden="true" />}
              className="btn-secondary nv-sidebar-create"
            />
          ) : null}
        </div>
      ) : null;
    body = (
      <>
        <div className="nv-nav-list">
          {links([
            { label: "工作台", href: "/", Icon: House, exact: true },
            { label: "我的待办", href: "/my/requirements", Icon: List, count: counts.myRequirements },
            { label: "我的 Bug", href: "/my/bugs", Icon: Bug, count: counts.myBugs },
          ])}
        </div>
        <NavGroup id="all" label="全部项目">
          {[
            { label: "项目", href: "/projects", Icon: Folder, exact: true },
            { label: "需求池", href: "/requirements", Icon: Inbox, exact: true },
            { label: "看板", href: "/board", Icon: Columns3 },
            { label: "发版", href: "/releases", Icon: Rocket },
            { label: "Bug", href: "/bugs", Icon: Bug },
            { label: "进展总览", href: "/leadership", Icon: ChartColumn },
          ].map((it) => (
            <NavLink key={it.href} item={it} active={!inProject && isActive(pathname, it)} onNavigate={go} />
          ))}
        </NavGroup>
        {projects.length ? (
          <NavGroup
            id="mine"
            label="我的项目"
            action={
              <Link href="/projects" className="icon-button nv-nav-group-act" aria-label="全部项目" title="全部项目">
                <Plus size={14} aria-hidden="true" />
              </Link>
            }
          >
            {projects.map((p) => (
              <ProjectNav
                key={p.id}
                project={p}
                current={p.id === projectId}
                activeTab={p.id === projectId ? tab : null}
                onNavigate={go}
              />
            ))}
          </NavGroup>
        ) : null}
      </>
    );
  } else if (section === "product") {
    // 产品内（Figma 27）：顶部是「← 全部产品」+ 产品切换卡；产品列表（Figma 26）：新建产品
    create = productIdFromPath(pathname) ? (
      <ProductNavTop onNavigate={go} initial={productNav} />
    ) : canManageProducts ? (
      <Link href="/products?new=1" className="btn-secondary nv-sidebar-create" onClick={go}>
        <Plus size={16} aria-hidden="true" />
        新建产品
      </Link>
    ) : null;
    body = (
      <Suspense fallback={null}>
        <ProductNav onNavigate={go} canManage={canManageProducts} initial={productNav} />
      </Suspense>
    );
  } else if (section === "docs") {
    create = <DocsNewPageButton spaces={projects} />;
    body = <DocsNav spaces={projects} onNavigate={go} />;
  } else if (section === "ai") {
    create = (
      <Link href="/ai" className="btn-secondary nv-sidebar-create" onClick={go}>
        <Plus size={16} aria-hidden="true" />
        新对话
      </Link>
    );
    body = (
      <Suspense fallback={null}>
        <AiNav onNavigate={go} />
      </Suspense>
    );
  } else if (section === "org") {
    create = (
      <Link href="/members?new=1" className="btn-secondary nv-sidebar-create" onClick={go}>
        <Plus size={16} aria-hidden="true" />
        邀请成员
      </Link>
    );
    body = (
      <div className="nv-nav-list">
        {links([
          { label: "成员管理", href: "/members", Icon: Users },
          { label: "角色权限", href: "/permissions", Icon: Shield },
          // 岗位 = 项目 / 产品中的职责（Figma 32），与角色（权限）分开维护
          { label: "岗位管理", href: "/positions", Icon: Briefcase },
          // 组织 / 企业 / 部门的配置（Figma 30）；按组织筛成员在组织架构页「查看成员」
          { label: "组织架构", href: "/orgs", Icon: Network },
        ])}
      </div>
    );
  } else {
    body = (
      <>
        <div className="nv-ws-card">
          <span className={`nv-ws-card-logo${systemLogo ? " has-img" : ""}`} aria-hidden="true">
            {systemLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={systemLogo} alt="" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/icon-192.png" alt="" />
            )}
          </span>
          <span className="nv-ws-card-text">
            <span className="nv-ws-card-name">{systemName || "小围空间"}</span>
            <span className="nv-ws-card-sub">{roleLabel || "团队成员"}</span>
          </span>
        </div>
        {isAdmin ? (
          <NavGroup id="nova" label="Weavi Space">
            {links([
              { label: "企业管理", href: "/system/enterprises", Icon: Building2 },
              { label: "系统超管", href: "/system/admins", Icon: ShieldCheck },
              { label: "演示体验", href: "/system/demo", Icon: MonitorPlay },
            ])}
          </NavGroup>
        ) : null}
        <NavGroup id="system" label="系统">
          {links([
            { label: "常规", href: "/system/general", Icon: SlidersHorizontal },
            { label: "云表格", href: "/system/feishu-tables", Icon: RefreshCw, also: ["/system/itr"] },
            { label: "研发流程", href: "/system/stages", Icon: Columns3 },
            { label: "归档与回收站", href: "/system/bin", Icon: Trash2 },
            ...(isAdmin || isEntAdmin ? [{ label: "登录管理", href: "/system/login", Icon: KeyRound, also: ["/system/feishu"] }] : []),
            ...(isAdmin || isEntAdmin ? [{ label: "AI 生图", href: "/system/ai-image", Icon: Sparkles }] : []),
            ...(isAdmin || isEntAdmin ? [{ label: "数据开放", href: "/system/data-access", Icon: Plug }] : []),
            ...(isAdmin || isEntAdmin ? [{ label: "企业 skill", href: "/system/skills", Icon: Sparkles }] : []),
            ...(isAdmin || isEntAdmin ? [{ label: "飞书组织同步", href: "/system/org-sync", Icon: Network }] : []),
          ])}
        </NavGroup>
        <NavGroup id="personal" label="个人">
          {links([
            { label: "账号管理", href: "/settings", Icon: UserRound, exact: true },
            { label: "模型管理", href: "/settings/models", Icon: Cpu },
            { label: "个人能力", href: "/settings/skills", Icon: Sparkles },
            { label: "本机 Agent", href: "/settings/agents", Icon: Plug },
            { label: "飞书机器人", href: "/settings/bot", Icon: MessageSquare },
            { label: "外观", href: "/system/appearance", Icon: Sun },
          ])}
        </NavGroup>
      </>
    );
  }

  const hidden = collapsed && !narrow;

  return (
    <>
      {presented || (narrow && phase === "closing") ? (
        <div className="app-nav-backdrop" data-phase={phase} onClick={onClose} />
      ) : null}
      <aside
        id="app-nav"
        className={`nv-sidebar${hidden ? " is-collapsed" : ""}`}
        data-phase={phase}
        data-clarity-layer={narrow ? "" : undefined}
        role={presented ? "dialog" : undefined}
        aria-modal={presented ? true : undefined}
        aria-labelledby={presented ? titleId : undefined}
        aria-label={presented ? undefined : `${SECTION_LABEL[section]}导航`}
        aria-hidden={hidden || (narrow && (phase === "closed" || phase === "closing")) ? true : undefined}
        {...inertProps(hidden || (narrow && phase !== "open" && phase !== "opening"))}
      >
        <nav className="nv-drawer-sections" aria-label="模块">
          {sections.map((s) => {
            const Icon = RAIL_ICONS[s.key];
            return (
              <Link
                key={s.key}
                href={s.href}
                className={`nv-drawer-section${s.key === section ? " is-active" : ""}`}
                aria-current={s.key === section ? "true" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                {SECTION_LABEL[s.key]}
              </Link>
            );
          })}
        </nav>
        <div className="nv-sidebar-head">
          {section === "system" ? (
            <span className="nv-sidebar-title-row">
              <Link href="/" className="icon-button nv-sidebar-back" aria-label="返回工作台" title="返回工作台">
                <ArrowLeft size={16} aria-hidden="true" />
              </Link>
              <span id={titleId} className="nv-sidebar-title">
                系统设置
              </span>
            </span>
          ) : (
            <span id={titleId} className="nv-sidebar-title">
              {section === "ai" ? "AI 助手" : SECTION_LABEL[section]}
            </span>
          )}
          {narrow ? (
            <button type="button" className="icon-button" aria-label="关闭导航" onClick={onClose} data-initial-focus="">
              <X size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              aria-label="收起侧栏"
              title="收起侧栏 ["
              onClick={onToggleCollapse}
            >
              <PanelLeft size={16} />
            </button>
          )}
        </div>
        {create ? <div className="nv-sidebar-create-wrap">{create}</div> : null}
        <div className="nv-sidebar-scroll">{body}</div>
        {section === "work" ? <SidebarHelp /> : null}
      </aside>
    </>
  );
}
