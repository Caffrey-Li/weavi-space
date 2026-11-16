import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { getAccess, projectWhere, requirementWhere } from "../access";

export async function loadNewBugPage(session: SessionUser | null, searchParams: { project?: string; requirement?: string }) {
  const access = session && (searchParams.project || searchParams.requirement) ? await getAccess(session) : null;
  const requirement = access && searchParams.requirement
    ? await prisma.requirement.findFirst({
        where: { id: searchParams.requirement, AND: [requirementWhere(access)] },
        select: { id: true, title: true, projectId: true, productId: true, productNodeId: true, project: { select: { key: true } } },
      })
    : null;
  const projectId = searchParams.project || requirement?.projectId || "";
  const findProject = (id: string) => prisma.project.findFirst({ where: { id, AND: [projectWhere(access!)] }, select: { id: true, name: true, key: true, iconUrl: true } });
  let project = access && projectId ? await findProject(projectId) : null;
  if (access && !project && searchParams.project && requirement?.projectId && requirement.projectId !== projectId) {
    project = await findProject(requirement.projectId);
  }
  const allowed = session ? await can(session, "bugs.edit", project?.id) : false;
  return { requirement, project, allowed };
}
