import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess, projectWhere } from "../access";
import { projectProgress } from "../shared/project-progress";

export async function loadProjectsPageData(session: SessionUser | null, options: { q: string; status: string; sort: "created" | "name" }) {
  const { q, status, sort } = options;
  const projects = await prisma.project.findMany({
    where: { ...(session ? projectWhere(await getAccess(session)) : { id: "__none__" }), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), ...(status ? { status } : { status: { not: "space" } }) },
    include: { members: { include: { user: true }, orderBy: { createdAt: "asc" } }, createdBy: true },
    orderBy: sort === "name" ? [{ name: "asc" }] : [{ createdAt: "asc" }],
  });
  const progress = await projectProgress(projects.map((p) => p.id));
  return { projects, progress };
}
