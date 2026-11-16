import type { NavScope } from "@/components/layout/PageContext";

/**
 * Nova B 版信息架构：左侧 60 宽图标栏的一级入口（用户入口已并入「设置 · 账号」）。
 * 每个入口有自己的 240 侧栏；页面按路径归属到一个入口。
 */
export type NavSection = "work" | "product" | "docs" | "ai" | "org" | "system";

export const SECTION_LABEL: Record<NavSection, string> = {
  work: "工作",
  product: "产品",
  docs: "文档",
  ai: "AI",
  org: "组织",
  system: "设置",
};

export const SECTION_HOME: Record<NavSection, string> = {
  work: "/",
  product: "/products",
  docs: "/docs",
  ai: "/ai",
  org: "/members",
  system: "/settings",
};

export function sectionFromPath(pathname: string): NavSection {
  const hit = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (hit("/docs")) return "docs";
  if (hit("/products")) return "product";
  if (hit("/ai")) return "ai";
  if (hit("/members") || hit("/permissions") || hit("/positions") || hit("/orgs")) return "org";
  // 账号（/settings）归入「设置」；强制改密的跳转仍指向 /settings
  if (hit("/system") || hit("/settings")) return "system";
  return "work";
}

/** 按路径判断是否处在某个项目里；详情页可用 PageContext 覆盖 */
export function scopeFromPath(pathname: string): NavScope {
  if (pathname.startsWith("/projects/")) return "project";
  return "global";
}

export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
}

/** 项目内子页面（切换项目时保留当前子页面） */
export const PROJECT_SUBPAGES = ["", "/requirements", "/board", "/bugs", "/plans", "/releases", "/members"] as const;

export const PROJECT_TABS: { sub: (typeof PROJECT_SUBPAGES)[number]; label: string }[] = [
  { sub: "", label: "概览" },
  { sub: "/requirements", label: "需求池" },
  { sub: "/board", label: "项目看板" },
  { sub: "/bugs", label: "Bug" },
  { sub: "/plans", label: "上线计划" },
  { sub: "/releases", label: "发版" },
  { sub: "/members", label: "成员" },
];

export function projectSubPath(pathname: string): string {
  const m = pathname.match(/^\/projects\/[^/]+(\/[^/]+)?/);
  const sub = m?.[1] || "";
  return (PROJECT_SUBPAGES as readonly string[]).includes(sub) ? sub : "";
}

/** 详情页（需求 / 发版）属于项目的哪个子页面 */
export function projectTabFor(pathname: string): string {
  if (pathname.startsWith("/projects/")) return projectSubPath(pathname);
  if (pathname.startsWith("/releases/")) return "/releases";
  if (pathname.startsWith("/requirements/")) return "/requirements";
  if (pathname.startsWith("/bugs")) return "/bugs";
  return "";
}
