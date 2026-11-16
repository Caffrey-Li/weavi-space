import { prisma } from "@pm-collab/db/prisma";
import { getHiddenStatuses } from "../shared/req-stages";
import { REQ_STATUS, REQ_STAGE_TABS, normalizeReqStatus, statusesForStage } from "../shared/constants";
import { parsePageParams } from "../shared/pagination";
import type { SessionUser } from "../auth";
import { getAccess, productWhere, projectWhere, requirementWhere } from "../access";

export type RequirementsPoolSearch = {
  q?: string;
  project?: string;
  status?: string;
  stage?: string;
  page?: string;
  pageSize?: string;
  /** "1" = 只看我负责的（任一负责人槽位是我） */
  mine?: string;
  /** "me" = 我提出的（提出人是我，或没填提出人时创建人是我）（T26） */
  proposer?: string;
  /** 所属产品 / 功能结构节点（含下级），从「产品」模块跳过来 */
  product?: string;
  productNode?: string;
};

export type RequirementsPoolOptions = {
  searchParams: RequirementsPoolSearch;
  /** 锁定到某项目时，忽略 URL project 参数 */
  lockedProjectId?: string;
  /** 当前用户，配合 mine=1 使用 */
  userId?: string;
};

export async function loadRequirementsPool(opts: RequirementsPoolOptions, session: SessionUser | null) {
  const parsed = parsePageParams(opts.searchParams);
  const pageSize = parsed.pageSize;
  const q = opts.searchParams.q?.trim() || "";
  const project = opts.lockedProjectId || opts.searchParams.project || "";
  const rawStatus = opts.searchParams.status || "";
  // 旧链接里的中文状态名（11-06 之前）也认
  const normalized = rawStatus ? normalizeReqStatus(rawStatus) : "";
  const status = REQ_STATUS.some((s) => s.key === normalized) ? normalized : "";
  const rawStage = opts.searchParams.stage || "";
  const stage = REQ_STAGE_TABS.some((t) => t.key && t.key === rawStage) ? rawStage : "";

  // 数据范围：角色只能看到的需求
  const access = session ? await getAccess(session) : null;
  const scope = access ? requirementWhere(access) : { id: "__none__" };
  const where: Record<string, unknown> = { archivedAt: null, AND: [scope] };
  if (project === "__none__") where.projectId = null;
  else if (project) where.projectId = project;
  // 阶段是一组状态；同时选了具体状态时两者取交集（不一致时结果为空，页面会提示）
  const stageStatuses = statusesForStage(stage);
  if (status && stageStatuses) {
    where.status = stageStatuses.includes(status) ? status : "__none__";
  } else if (status) {
    where.status = status;
  } else if (stageStatuses) {
    where.status = { in: stageStatuses };
  }
  if (q) where.title = { contains: q, mode: "insensitive" };
  // 产品筛选：productNode 连同下级节点一起算
  const productId = opts.searchParams.product || "";
  const productNodeId = opts.searchParams.productNode || "";
  let productFilter: { id: string; name: string } | null = null;
  let productNodeFilter: { id: string; name: string } | null = null;
  if (productNodeId) {
    const node = await prisma.productNode.findUnique({ where: { id: productNodeId }, select: { id: true, name: true, productId: true } });
    const visibleProduct = node && access
      ? await prisma.product.findUnique({ where: { id: node.productId, AND: [productWhere(access)] }, select: { id: true } })
      : null;
    if (node && visibleProduct) {
      const all = await prisma.productNode.findMany({ where: { productId: node.productId }, select: { id: true, parentId: true } });
      const ids = new Set([node.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of all) {
          if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id);
            grew = true;
          }
        }
      }
      where.productNodeId = { in: Array.from(ids) };
      productNodeFilter = { id: node.id, name: node.name };
    }
  } else if (productId) {
    const product = access
      ? await prisma.product.findUnique({ where: { id: productId, AND: [productWhere(access)] }, select: { id: true, name: true } })
      : null;
    if (product) {
      where.productId = product.id;
      productFilter = product;
    }
  }
  const mine = opts.searchParams.mine === "1" && Boolean(opts.userId);
  if (mine) where.assignees = { some: { userId: opts.userId } };
  const proposedByMe = opts.searchParams.proposer === "me" && Boolean(session);
  const proposerCond = proposedByMe ? { OR: [{ proposerId: session!.id }, { proposerId: null, creatorId: session!.id }] } : null;
  if (proposerCond) (where.AND as unknown[]).push(proposerCond);

  // 阶段 Tab 的计数：沿用项目与搜索条件，但不受阶段/状态筛选影响
  const baseWhere: Record<string, unknown> = { archivedAt: null, AND: [scope] };
  if (where.projectId !== undefined) baseWhere.projectId = where.projectId;
  if (q) baseWhere.title = where.title;
  if (mine) baseWhere.assignees = where.assignees;
  if (proposerCond) (baseWhere.AND as unknown[]).push(proposerCond);
  if (where.productId !== undefined) baseWhere.productId = where.productId;
  if (where.productNodeId !== undefined) baseWhere.productNodeId = where.productNodeId;

  // 先数总数，把越界页码收回到合法范围（筛选后不会停在空页）
  const total = await prisma.requirement.count({ where });
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(parsed.page, lastPage);

  const [items, projects, lockedProject, grouped] = await Promise.all([
    prisma.requirement.findMany({
      where,
      include: {
        project: true,
        assignees: { include: { user: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.findMany({
      where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, key: true },
    }),
    opts.lockedProjectId
      ? prisma.project.findUnique({
          where: { id: opts.lockedProjectId },
          select: { id: true, name: true, key: true, status: true, iconUrl: true },
        })
      : Promise.resolve(null),
    prisma.requirement.groupBy({ by: ["status"], where: baseWhere, _count: true }),
  ]);

  const byStatus = new Map<string, number>();
  for (const g of grouped) {
    const k = normalizeReqStatus(g.status);
    byStatus.set(k, (byStatus.get(k) || 0) + g._count);
  }
  const stageCounts: Record<string, number> = {};
  for (const t of REQ_STAGE_TABS) {
    stageCounts[t.key] = t.statuses.length
      ? t.statuses.reduce((a, s) => a + (byStatus.get(s) || 0), 0)
      : Array.from(byStatus.values()).reduce((a, n) => a + n, 0);
  }

  const hidden = await getHiddenStatuses();
  return {
    page,
    pageSize,
    q,
    mine,
    project,
    status,
    stage,
    total,
    items,
    projects,
    lockedProject,
    // 停用的阶段不出现在状态筛选里（Figma 52）
    statuses: REQ_STATUS.filter((s) => !hidden.includes(s.key)).map((s) => ({ key: s.key, label: s.label })),
    stageCounts,
    productFilter,
    productNodeFilter,
    stageConflict: Boolean(status && stageStatuses && !stageStatuses.includes(status)),
    proposer: proposedByMe ? "me" : "",
    hasFilters: Boolean(q || mine || proposedByMe || productFilter || productNodeFilter || (!opts.lockedProjectId && project) || status || stage),
  };
}

/** 列表行 → 客户端表格所需的最小数据 */
export function toPoolRows(items: Awaited<ReturnType<typeof loadRequirementsPool>>["items"]) {
  return items.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    code: r.project ? `${r.project.key}-${r.id.slice(-4).toUpperCase()}` : r.id.slice(-6).toUpperCase(),
    project: r.project ? { id: r.project.id, name: r.project.name } : null,
    owners: r.assignees
      .filter((a) => ["owner", "product", "frontend", "backend", "qa"].includes(a.role))
      .map((a) => ({ name: a.user.name, avatarUrl: a.user.avatarUrl }))
      .filter((o, i, arr) => arr.findIndex((x) => x.name === o.name) === i)
      .slice(0, 4),
    plannedEndAt: r.plannedEndAt ? r.plannedEndAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type PoolRow = ReturnType<typeof toPoolRows>[number];
