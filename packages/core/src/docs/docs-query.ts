import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import type { SessionUser } from "../auth";
import { BUG_STATUS, normalizeReqStatus, reqStatusLabel } from "../shared/constants";
import type { RefInfo } from "../shared/doc-html";
import { bugWhere, canSeeProject, getAccess, projectWhere, requirementWhere } from "../access";

/** 项目空间可见范围 = 角色的数据范围（与项目列表一致） */
export async function spaceWhere(user: Pick<SessionUser, "id" | "globalRole">) {
  return projectWhere(await getAccess(user));
}

export async function canViewSpace(user: Pick<SessionUser, "id" | "globalRole">, projectId: string) {
  return canSeeProject(user, projectId);
}

/** 新建、编辑、发布、移动、删除页面都走 docs.edit（角色权限矩阵里可配置） */
export function canEditDocs(user: SessionUser | { id: string; globalRole: string }, projectId: string) {
  return can(user, "docs.edit", projectId);
}

export const DOC_STATUS_TAGS = [
  { key: "draft", label: "草稿", tone: "neutral" },
  { key: "review", label: "评审中", tone: "warning" },
  { key: "approved", label: "评审通过", tone: "success" },
  { key: "deprecated", label: "已废弃", tone: "danger" },
] as const;

export function docStatusTag(key: string | null | undefined) {
  return DOC_STATUS_TAGS.find((t) => t.key === key) ?? null;
}

export type TreeNode = { id: string; parentId: string | null; groupId: string | null; title: string; published: boolean; hasDraft: boolean };

export async function loadTree(projectId: string): Promise<TreeNode[]> {
  const rows = await prisma.docPage.findMany({
    where: { projectId },
    select: { id: true, parentId: true, groupId: true, title: true, draftTitle: true, version: true, draftBody: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    groupId: r.groupId,
    title: (r.version === 0 ? r.draftTitle || r.title : r.title) || "无标题页面",
    published: r.version > 0,
    hasDraft: r.draftBody != null,
  }));
}

/** 从根到当前页的祖先链（不含当前页） */
export async function ancestorsOf(pageId: string) {
  const out: { id: string; title: string }[] = [];
  let cur = await prisma.docPage.findUnique({ where: { id: pageId }, select: { parentId: true } });
  let guard = 0;
  while (cur?.parentId && guard++ < 50) {
    const p = await prisma.docPage.findUnique({
      where: { id: cur.parentId },
      select: { id: true, title: true, draftTitle: true, version: true, parentId: true },
    });
    if (!p) break;
    out.unshift({ id: p.id, title: (p.version === 0 ? p.draftTitle || p.title : p.title) || "无标题页面" });
    cur = p;
  }
  return out;
}

/** 防止把页面移动到自己的子孙下面 */
export async function isDescendant(pageId: string, candidateParentId: string) {
  let cur: string | null = candidateParentId;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur === pageId) return true;
    const row: { parentId: string | null } | null = await prisma.docPage.findUnique({
      where: { id: cur },
      select: { parentId: true },
    });
    cur = row?.parentId ?? null;
  }
  return false;
}

export const REQ_TONE: Record<string, string> = {
  req_in_progress: "neutral",
  req_done: "neutral",
  dev_todo: "info",
  dev_in_progress: "info",
  dev_done: "purple",
  test_todo: "warning",
  test_in_progress: "warning",
  test_done: "info",
  online: "success",
  cancelled: "neutral",
};
export const BUG_TONE: Record<string, string> = {
  open: "danger",
  in_progress: "info",
  resolved: "purple",
  closed: "success",
  reopened: "warning",
  cancelled: "neutral",
};

export function reqCode(id: string) {
  return `REQ-${id.slice(-4).toUpperCase()}`;
}
export function bugCodeOf(id: string) {
  return `BUG-${id.slice(-4).toUpperCase()}`;
}

/** 取一批需求 / Bug 的实时标题与状态，key 为 `req:<id>` / `bug:<id>`。只返回阅读者数据范围内的，其余按已删除显示 */
export async function loadRefInfo(refs: { kind: "req" | "bug"; id: string }[], viewer: Pick<SessionUser, "id" | "globalRole">): Promise<Map<string, RefInfo>> {
  const access = await getAccess(viewer);
  const reqIds = refs.filter((r) => r.kind === "req").map((r) => r.id);
  const bugIds = refs.filter((r) => r.kind === "bug").map((r) => r.id);
  const [reqs, bugs] = await Promise.all([
    reqIds.length
      ? prisma.requirement.findMany({ where: { id: { in: reqIds }, AND: [requirementWhere(access)] }, select: { id: true, title: true, status: true } })
      : [],
    bugIds.length
      ? prisma.bug.findMany({ where: { id: { in: bugIds }, AND: [bugWhere(access)] }, select: { id: true, title: true, status: true } })
      : [],
  ]);
  const map = new Map<string, RefInfo>();
  for (const r of reqs) {
    const st = normalizeReqStatus(r.status);
    map.set(`req:${r.id}`, {
      title: r.title,
      code: reqCode(r.id),
      status: reqStatusLabel(st),
      tone: REQ_TONE[st] || "neutral",
      href: `/requirements/${r.id}`,
    });
  }
  for (const b of bugs) {
    map.set(`bug:${b.id}`, {
      title: b.title,
      code: bugCodeOf(b.id),
      status: BUG_STATUS.find((s) => s.key === b.status)?.label || b.status,
      tone: BUG_TONE[b.status] || "neutral",
      href: `/bugs?bug=${b.id}`,
    });
  }
  return map;
}



export function fmtDay(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function pageDisplayTitle(p: { title: string; draftTitle: string | null; version: number }) {
  return (p.version === 0 ? p.draftTitle || p.title : p.title) || "无标题页面";
}
