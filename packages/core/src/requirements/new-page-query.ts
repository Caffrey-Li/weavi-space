import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, projectWhere, requirementWhere } from "../access";

/**
 * 新建需求页的 ?project= / ?parent=：只在当前用户的数据范围内查，
 * 看不到的项目 / 需求与不存在的 id 行为一致（不显示名称、不锁定项目）。
 */
export async function loadNewRequirementPage(session: SessionUser | null, searchParams: { project?: string; parent?: string }) {
  const access = session && (searchParams.project || searchParams.parent) ? await getAccess(session) : null;
  const project = access && searchParams.project
    ? await prisma.project.findFirst({ where: { id: searchParams.project, AND: [projectWhere(access)] }, select: { id: true, name: true, iconUrl: true } })
    : null;
  const parent = access && searchParams.parent
    ? await prisma.requirement.findFirst({ where: { id: searchParams.parent, AND: [requirementWhere(access)] }, select: { id: true, title: true } })
    : null;
  const allowed = session ? await can(session, "requirements.create", project?.id) : false;
  return { project, parent, allowed };
}
