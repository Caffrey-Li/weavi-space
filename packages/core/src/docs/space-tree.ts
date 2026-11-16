import type { SessionUser } from "../auth";
import { result, error } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace, loadTree } from "./docs-query";
import { fallbackGroupId, listDocGroupsWithAliases } from "../shared/doc-groups";

/** 空间页面树（侧栏用）：分组 + 平铺页面，前端按 groupId / parentId 组树 */
export async function GET(session: SessionUser, params: { id: string }) {
  const space = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, key: true, iconUrl: true, status: true },
  });
  if (!space) return error("空间不存在", 404);
  if (!(await canViewSpace(session, space.id))) return error("无权查看该空间", 403);
  const { groups, aliases } = await listDocGroupsWithAliases(space.id);
  const [pages, canEdit] = await Promise.all([loadTree(space.id), canEditDocs(session, space.id)]);
  // 根页面的分组不存在（没分过组或分组被删）时归到默认分组
  const ids = new Set(groups.map((g) => g.id));
  const fallback = fallbackGroupId(groups);
  const out = pages.map((p) => {
    if (p.parentId) return p;
    const gid = p.groupId ? aliases.get(p.groupId) || p.groupId : null;
    return { ...p, groupId: gid && ids.has(gid) ? gid : fallback };
  });
  const { status, ...rest } = space;
  return result({ space: { ...rest, kind: status === "space" ? "product" : "project" }, groups, pages: out, canEdit });
}
