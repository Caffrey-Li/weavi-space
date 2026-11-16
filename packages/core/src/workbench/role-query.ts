import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { bugWhere, getAccess, productWhere, projectWhere, requirementWhere } from "../access";
import { projectProgress } from "../shared/project-progress";
import { REQ_STATUS } from "../shared/constants";

/**
 * 工作台版式（T17）：管理者（系统管理员 / 管理者角色，优先）、产品（产品经理）、项目（项目经理）、
 * 开发（前端 / 后端 / 技术负责人 / 测试）、业务（业务岗位）；没有岗位的人用开发版式（原工作台）。
 */
export type WorkbenchLayout = "manager" | "product" | "project" | "dev" | "business";
export const LAYOUT_LABEL: Record<WorkbenchLayout, string> = { manager: "管理者", product: "产品", project: "项目", dev: "开发", business: "业务" };

export function layoutFor(globalRole: string, position: string | null | undefined): WorkbenchLayout {
  if (globalRole === ADMIN_ROLE || globalRole === "manager") return "manager";
  if (position === "product") return "product";
  if (position === "pm") return "project";
  if (position === "business") return "business";
  return "dev";
}

export async function loadWorkbenchLayout(user: SessionUser) {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { position: true } });
  return layoutFor(user.globalRole, me?.position);
}

type Row = { id: string; name: string; href: string; meta: string; progress?: number };
type Kpi = { label: string; value: number; note: string; href: string; danger?: boolean };
export type RoleExtras = { kpis: Kpi[]; listTitle: string; rows: Row[]; side: { title: string; rows: Row[] } | null; more: { href: string; label: string } } | null;

/** 各版式额外的指标和列表（都在本人数据范围内） */
export async function loadRoleExtras(user: SessionUser, layout: WorkbenchLayout, now = new Date()): Promise<RoleExtras> {
  if (layout === "dev") return null;
  const access = await getAccess(user);
  const rq = requirementWhere(access);
  const bq = bugWhere(access);
  if (layout === "manager" || layout === "project") {
    const projects = await prisma.project.findMany({
      where: { status: "active", ...projectWhere(access), ...(layout === "project" ? { members: { some: { userId: user.id } } } : {}) },
      select: { id: true, name: true, plannedEndAt: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    const ids = projects.map((p) => p.id);
    const [prog, overdue, severe, releases] = await Promise.all([
      projectProgress(ids),
      prisma.requirement.count({ where: { archivedAt: null, projectId: { in: ids }, status: { notIn: ["online", "cancelled"] }, plannedEndAt: { lt: now }, AND: [rq] } }),
      prisma.bug.count({ where: { projectId: { in: ids }, status: { in: ["open", "in_progress", "reopened"] }, severity: { in: ["blocker", "critical"] }, AND: [bq] } }),
      prisma.release.findMany({ where: { projectId: { in: ids }, status: { in: ["planning", "frozen", "releasing"] }, plannedAt: { gte: now } }, select: { id: true, version: true, plannedAt: true, project: { select: { name: true } } }, orderBy: { plannedAt: "asc" }, take: 5 }),
    ]);
    let all = 0;
    let done = 0;
    const rows: Row[] = projects.map((p) => {
      const g = prog.get(p.id) || { done: 0, all: 0 };
      all += g.all;
      done += g.done;
      return { id: p.id, name: p.name, href: `/projects/${p.id}`, meta: `需求 ${g.done}/${g.all} 已上线${p.plannedEndAt ? ` · 计划 ${p.plannedEndAt.toISOString().slice(0, 10)}` : ""}`, progress: g.all ? Math.round((g.done / g.all) * 100) : 0 };
    });
    return {
      kpis: [
        { label: layout === "manager" ? "进行中项目" : "我参与的项目", value: projects.length, note: `整体进度 ${all ? Math.round((done / all) * 100) : 0}%`, href: "/projects" },
        { label: "需求已上线", value: done, note: `共 ${all} 个需求`, href: "/requirements" },
        { label: "逾期需求", value: overdue, note: overdue ? "需要跟进" : "没有逾期", danger: overdue > 0, href: "/requirements" },
        { label: "严重 Bug", value: severe, note: severe ? "阻塞 / 严重未关闭" : "没有严重 Bug", danger: severe > 0, href: "/bugs" },
      ],
      listTitle: layout === "manager" ? "各项目进度" : "我的项目",
      rows,
      side: { title: "近期上线计划", rows: releases.map((r) => ({ id: r.id, name: `${r.project.name} v${r.version}`, href: `/releases/${r.id}`, meta: r.plannedAt ? r.plannedAt.toISOString().slice(0, 10) : "" })) },
      more: layout === "manager" ? { href: "/leadership", label: "进展总览" } : { href: "/board", label: "看板" },
    };
  }
  if (layout === "product") {
    const products = await prisma.product.findMany({ where: { ...productWhere(access), ownerId: user.id, status: { not: "archived" } }, select: { id: true, name: true, _count: { select: { requirements: true, nodes: true } } }, take: 20 });
    const [inReq, pool, mine] = await Promise.all([
      prisma.requirement.count({ where: { archivedAt: null, status: { in: ["req_in_progress", "req_done"] }, assignees: { some: { userId: user.id } }, AND: [rq] } }),
      prisma.requirement.count({ where: { archivedAt: null, projectId: null, status: { not: "cancelled" }, AND: [rq] } }),
      prisma.requirement.count({ where: { archivedAt: null, creatorId: user.id, createdAt: { gte: new Date(now.getTime() - 30 * 864e5) }, AND: [rq] } }),
    ]);
    return {
      kpis: [
        { label: "我负责的产品", value: products.length, note: `${products.reduce((n, p) => n + p._count.nodes, 0)} 个功能节点`, href: "/products" },
        { label: "需求阶段中", value: inReq, note: "需求中 / 需求完成", href: "/my/requirements?stage=req" },
        { label: "公共需求池", value: pool, note: "待分配到项目", href: "/requirements" },
        { label: "近 30 天我提的需求", value: mine, note: "含已上线", href: "/requirements" },
      ],
      listTitle: "我负责的产品",
      rows: products.map((p) => ({ id: p.id, name: p.name, href: `/products/${p.id}`, meta: `${p._count.requirements} 个需求 · ${p._count.nodes} 个功能节点` })),
      side: null,
      more: { href: "/products", label: "全部产品" },
    };
  }
  // business：我提出的需求和 Bug 的进展
  const [reqs, bugs, online] = await Promise.all([
    prisma.requirement.findMany({ where: { archivedAt: null, creatorId: user.id, status: { not: "cancelled" }, AND: [rq] }, select: { id: true, title: true, status: true, plannedEndAt: true, project: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.bug.count({ where: { creatorId: user.id, status: { in: ["open", "in_progress", "reopened"] }, AND: [bq] } }),
    prisma.requirement.count({ where: { creatorId: user.id, status: "online", updatedAt: { gte: new Date(now.getTime() - 30 * 864e5) }, AND: [rq] } }),
  ]);
  return {
    kpis: [
      { label: "我提的需求", value: reqs.length, note: "进行中", href: "/requirements" },
      { label: "近 30 天上线", value: online, note: "我提的需求", href: "/requirements" },
      { label: "我提的 Bug", value: bugs, note: "还没解决", href: "/bugs" },
      { label: "待验收", value: reqs.filter((r) => r.status === "test_done").length, note: "测试完成待上线", href: "/requirements" },
    ],
    listTitle: "我提出的需求",
    rows: reqs.map((r) => ({ id: r.id, name: r.title, href: `/requirements/${r.id}`, meta: `${r.project?.name || "公共池"} · ${REQ_STATUS.find((s) => s.key === r.status)?.label || r.status}${r.plannedEndAt ? ` · 计划 ${r.plannedEndAt.toISOString().slice(0, 10)}` : ""}` })),
    side: null,
    more: { href: "/requirements/new", label: "提需求" },
  };
}
