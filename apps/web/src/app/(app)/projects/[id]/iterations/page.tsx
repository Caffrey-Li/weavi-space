import { notFound } from "next/navigation";
import { requireProjectPage } from "@/lib/page-guard";
import { prisma } from "@/lib/prisma";
import { PageContext } from "@/components/layout/PageContext";
import { projectIterations } from "@pm-collab/core/requirements/iterations";
import { flowForProject } from "@pm-collab/core/flow/service";
import { ProjectIterations } from "@/components/projects/ProjectIterations";

export const dynamic = "force-dynamic";

/** 项目 · 迭代（T43，Figma 89C）：Scrum 模式的项目在这里规划迭代 */
export default async function ProjectIterationsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await requireProjectPage(id);
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
  if (!project) notFound();
  const [data, flow] = await Promise.all([projectIterations(session, id), flowForProject(id)]);
  if (!data) notFound();
  return (
    <div className="page-overview is-wider">
      <PageContext scope="project" projectId={id} crumbs={[{ label: "项目", href: "/projects" }, { label: project.name, href: `/projects/${id}` }, { label: "迭代" }]} />
      <ProjectIterations projectId={id} data={data} scrum={flow.mode === "scrum"} />
    </div>
  );
}
