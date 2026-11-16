import { requireProjectPage } from "@/lib/page-guard";
import { notFound } from "next/navigation";
import { MembersManager } from "@/components/members/MembersManager";
import { PageContext } from "@/components/layout/PageContext";
import { loadProjectMembersPage } from "@pm-collab/core/projects/id-members-query";

export default async function ProjectMembersPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await requireProjectPage(params.id);
  const data = await loadProjectMembersPage(session, params.id);
  if (!data) notFound();

  return (
    <>
      <PageContext
        crumbs={[
          { label: "项目", href: "/projects" },
          { label: data.projectName, href: `/projects/${data.projectId}` },
          { label: "成员" },
        ]}
      />
      <MembersManager
        projectId={data.projectId}
        projectName={data.projectName}
        canManage={data.canManage}
        members={data.members}
        users={data.users}
        orgs={data.orgs}
        positions={data.positions}
      />
    </>
  );
}
