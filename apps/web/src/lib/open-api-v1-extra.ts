/**
 * T34 开放接口 v1 补充的只读接口（MCP 工具也走这里）：
 * - GET docs/spaces/:id/pages   文档空间的页面目录（docs.read）
 * - GET members?q=              本企业成员（members.read）
 * - GET orgs                    本企业组织架构（members.read）
 * - GET projects/:id/progress   项目进展：需求 / Bug 按状态计数、未完成的发版（projects.read）
 * - GET reports?projectId=      项目周报（reports.read）
 * - GET docs/search?q=&spaceId=  按关键词搜文档标题和正文（docs.read，T36）
 * - GET requirements/:id/tasks      任务和计划（requirements.read，T45）
 * - GET requirements/:id/artifacts  资料：UI 设计 / 原型 / 文档 / 用例 / 报告（requirements.read）
 * - GET requirements/:id/code       关联的 GitLab 分支 / 提交 / MR（requirements.read）
 * - GET tasks?all=1                 指派给我的任务（requirements.read）
 * - GET projects/:id/iterations     项目迭代（projects.read）
 * 数据范围和网页一致：项目按 projectWhere，成员按 userWhere，组织按 Access.orgIds。
 */
import { NextResponse } from "next/server";
import { authorizeApiToken, type ApiTokenPrincipal } from "@pm-collab/core/api-tokens";
import type { ApiScope } from "@pm-collab/core/api-tokens/scopes";
import { prisma } from "@/lib/prisma";
import { inProjectsWhere, projectWhere, requirementWhere, bugWhere, userWhere } from "@/lib/access";

const err = (status: number, message: string, code: string) => NextResponse.json({ error: { code, message } }, { status });
const ok = (data: unknown, meta?: { page: number; pageSize: number; total: number }) => NextResponse.json(meta ? { data, meta } : { data });

function paging(url: URL) {
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null;
  return { page, pageSize };
}

/** 是这几个补充接口之一就处理并返回响应，否则返回 null 交给原逻辑 */
export async function v1ReadExtra(principal: ApiTokenPrincipal, path: string[], url: URL): Promise<NextResponse | null> {
  const route =
    path.length === 4 && path[0] === "docs" && path[1] === "spaces" && path[3] === "pages" ? "pages" :
    path.length === 1 && path[0] === "members" ? "members" :
    path.length === 1 && path[0] === "orgs" ? "orgs" :
    path.length === 3 && path[0] === "projects" && path[2] === "progress" ? "progress" :
    path.length === 1 && path[0] === "reports" ? "reports" :
    path.length === 2 && path[0] === "docs" && path[1] === "search" ? "search" :
    path.length === 3 && path[0] === "requirements" && ["tasks", "artifacts", "code"].includes(path[2]) ? `req-${path[2]}` :
    path.length === 1 && path[0] === "tasks" ? "my-tasks" :
    path.length === 3 && path[0] === "projects" && path[2] === "iterations" ? "iterations" : null;
  if (!route) return null;
  const scope: ApiScope = route === "pages" || route === "search" ? "docs.read" : route === "progress" || route === "iterations" ? "projects.read" : route === "reports" ? "reports.read" : route.startsWith("req-") || route === "my-tasks" ? "requirements.read" : "members.read";
  const authorized = await authorizeApiToken(principal, scope);
  if (!authorized) return err(403, "令牌权限不足", "forbidden");
  const { access } = authorized;
  const missing = () => err(404, "资源不存在", "not_found");

  // T45：任务、资料、代码、迭代（数据范围和网页一致，看不到按 404）
  if (route.startsWith("req-")) {
    const rid = path[1];
    if (route === "req-tasks") {
      const { listTasks, requirementPlan } = await import("@pm-collab/core/requirements/tasks");
      const [list, plan] = await Promise.all([listTasks(authorized.user, rid), requirementPlan(authorized.user, rid)]);
      return list && plan ? ok({ tasks: list.tasks, plan }) : missing();
    }
    if (route === "req-artifacts") {
      const { listArtifacts } = await import("@pm-collab/core/requirements/artifacts");
      const a = await listArtifacts(authorized.user, rid);
      return a ? ok({ items: a.items.map((x) => ({ ...x, href: x.href.startsWith("/") ? `${url.origin}${x.href}` : x.href })), completeness: a.completeness }) : missing();
    }
    const { requirementCode } = await import("@pm-collab/core/git/service");
    const c = await requirementCode(authorized.user, rid);
    return c ? ok({ repos: c.repos.map((r) => ({ path: r.path, webUrl: r.webUrl, defaultBranch: r.defaultBranch })), links: c.links, branchName: c.branchName }) : missing();
  }
  if (route === "my-tasks") {
    const { myTasks } = await import("@pm-collab/core/requirements/tasks");
    return ok(await myTasks(authorized.user, { all: url.searchParams.get("all") === "1", take: Number(url.searchParams.get("limit")) || 50 }));
  }
  if (route === "iterations") {
    const { projectIterations } = await import("@pm-collab/core/requirements/iterations");
    const d = await projectIterations(authorized.user, path[1]);
    return d ? ok({ iterations: d.iterations, backlog: d.backlog }) : missing();
  }
  if (route === "search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return err(400, "请给出搜索关键词 q", "invalid_request");
    const { searchDocs } = await import("@pm-collab/core/docs/search");
    const r = await searchDocs(authorized.user, { q, spaceId: url.searchParams.get("spaceId"), limit: Number(url.searchParams.get("limit")) || 20 });
    return ok(r.hits);
  }
  if (route === "pages" || route === "progress") {
    const id = route === "pages" ? path[2] : path[1];
    const project = await prisma.project.findFirst({ where: { id, AND: [projectWhere(access)] }, select: { id: true, name: true } });
    if (!project) return missing();
    if (route === "pages") {
      const pages = await prisma.docPage.findMany({
        where: { projectId: id, deletedAt: null, archivedAt: null },
        select: { id: true, title: true, parentId: true, kind: true, sortOrder: true, publishedAt: true, updatedAt: true },
        orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }],
        take: 1000,
      });
      return ok(pages.map((p) => ({ id: p.id, title: p.title, parentId: p.parentId, kind: p.kind, published: Boolean(p.publishedAt), updatedAt: p.updatedAt.toISOString() })));
    }
    const [reqs, bugs, releases] = await Promise.all([
      prisma.requirement.groupBy({ by: ["status"], where: { projectId: id, archivedAt: null, AND: [requirementWhere(access)] }, _count: { _all: true } }),
      prisma.bug.groupBy({ by: ["status"], where: { projectId: id, AND: [bugWhere(access)] }, _count: { _all: true } }),
      prisma.release.findMany({ where: { projectId: id, status: { in: ["planning", "frozen", "releasing"] } }, select: { id: true, version: true, status: true, plannedAt: true }, orderBy: { plannedAt: "asc" }, take: 10 }),
    ]);
    const count = (rows: { status: string; _count: { _all: number } }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    const reqTotal = reqs.reduce((n, r) => n + (r.status === "cancelled" ? 0 : r._count._all), 0);
    const online = reqs.find((r) => r.status === "online")?._count._all || 0;
    return ok({
      project,
      requirements: { total: reqTotal, online, percent: reqTotal ? Math.round((online / reqTotal) * 100) : 0, byStatus: count(reqs) },
      bugs: { byStatus: count(bugs) },
      openReleases: releases.map((r) => ({ id: r.id, version: r.version, status: r.status, plannedAt: r.plannedAt?.toISOString().slice(0, 10) || null })),
    });
  }

  const pg = paging(url);
  if (!pg) return err(400, "分页参数无效，pageSize 最大为 100", "invalid_request");
  if (route === "members") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
    const where = { isActive: true, demoKind: null, AND: [userWhere(access), ...(q ? [{ OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] }] : [])] };
    const [rows, total, positions, orgs] = await Promise.all([
      prisma.user.findMany({ where, select: { id: true, name: true, email: true, position: true, globalRole: true, orgId: true }, orderBy: { name: "asc" }, skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize }),
      prisma.user.count({ where }),
      prisma.position.findMany({ select: { key: true, name: true } }),
      prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);
    const pos = new Map(positions.map((p) => [p.key, p.name]));
    const org = new Map(orgs.map((o) => [o.id, o.name]));
    return ok(rows.map((u) => ({ id: u.id, name: u.name, email: u.email, position: u.position ? pos.get(u.position) || u.position : null, role: u.globalRole, org: u.orgId ? org.get(u.orgId) || null : null })), { ...pg, total });
  }
  if (route === "orgs") {
    const where = access.orgIds === null ? {} : { id: { in: access.orgIds } };
    const [rows, total] = await Promise.all([
      prisma.organization.findMany({ where, select: { id: true, name: true, type: true, parentId: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize }),
      prisma.organization.count({ where }),
    ]);
    const counts = await prisma.user.groupBy({ by: ["orgId"], where: { orgId: { in: rows.map((r) => r.id) }, isActive: true }, _count: { _all: true } });
    const n = new Map(counts.map((c) => [c.orgId, c._count._all]));
    return ok(rows.map((o) => ({ ...o, members: n.get(o.id) || 0 })), { ...pg, total });
  }
  // reports
  const projectId = url.searchParams.get("projectId");
  const where = { ...(projectId ? { projectId } : {}), ...inProjectsWhere(access) };
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, AND: [projectWhere(access)] }, select: { id: true } }))) return missing();
  const [rows, total] = await Promise.all([
    prisma.projectReport.findMany({ where, orderBy: { weekStart: "desc" }, skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize }),
    prisma.projectReport.count({ where }),
  ]);
  const projects = await prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, name: true } });
  const pn = new Map(projects.map((p) => [p.id, p.name]));
  return ok(rows.map((r) => ({ id: r.id, projectId: r.projectId, projectName: pn.get(r.projectId) || null, weekStart: r.weekStart.toISOString().slice(0, 10), done: r.done, next: r.next, risks: r.risks, progress: r.progress })), { ...pg, total });
}
