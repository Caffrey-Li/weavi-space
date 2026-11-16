import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { canViewSpace, bugCodeOf, reqCode } from "./docs-query";
import { normalizeReqStatus, reqStatusLabel, BUG_STATUS } from "../shared/constants";
import { bugWhere, getAccess, requirementWhere } from "../access";

/** 编辑器「关联需求」选择器：优先本空间（项目）的需求和 Bug，按标题搜索 */
export async function GET(session: SessionUser, input: DocAccess = { url: "", body: null }) {
  const url = new URL(input.url);
  const spaceId = url.searchParams.get("spaceId") || "";
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (!spaceId) return error("缺少空间", 400);
  if (!(await canViewSpace(session, spaceId))) return error("无权查看该空间", 403);

  // 搜索词可以是编号尾号（REQ-1A2B / BUG-1A2B）
  const code = /^(req|bug)-?([a-z0-9]{2,})$/i.exec(q);
  const titleWhere = q && !code ? { title: { contains: q, mode: "insensitive" as const } } : {};
  const access = await getAccess(session);
  const [reqs, bugs] = await Promise.all([
    code && code[1].toLowerCase() === "bug"
      ? []
      : prisma.requirement.findMany({
          where: { projectId: spaceId, archivedAt: null, ...titleWhere, ...(code ? { id: { endsWith: code[2].toLowerCase() } } : {}), AND: [requirementWhere(access)] },
          select: { id: true, title: true, status: true },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
    code && code[1].toLowerCase() === "req"
      ? []
      : prisma.bug.findMany({
          where: { projectId: spaceId, archivedAt: null, ...titleWhere, ...(code ? { id: { endsWith: code[2].toLowerCase() } } : {}), AND: [bugWhere(access)] },
          select: { id: true, title: true, status: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
  ]);
  return result({
    items: [
      ...reqs.map((r) => ({
        kind: "req" as const,
        id: r.id,
        code: reqCode(r.id),
        title: r.title,
        status: reqStatusLabel(normalizeReqStatus(r.status)),
      })),
      ...bugs.map((b) => ({
        kind: "bug" as const,
        id: b.id,
        code: bugCodeOf(b.id),
        title: b.title,
        status: BUG_STATUS.find((s) => s.key === b.status)?.label || b.status,
      })),
    ],
  });
}
