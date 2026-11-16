import { loadNewRequirementPage } from "@pm-collab/core/requirements/new-page-query";
import { getSession } from "@/lib/auth";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { RequirementWorkspace, type RequirementWorkspaceData } from "@/components/requirements/RequirementWorkspace";

/** 新建需求全页（Figma 25）：?project=<id> 在项目内新建（锁定归属），?parent=<id> 作为子需求 */
export default async function NewRequirementPage(
  props: { searchParams: Promise<{ project?: string; parent?: string; status?: string }> }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const { project, parent, allowed } = await loadNewRequirementPage(session, searchParams);
  const poolHref = project ? `/projects/${project.id}/requirements` : "/requirements";

  const data: RequirementWorkspaceData = {
    title: "",
    descriptionHtml: "",
    status: "req_in_progress",
    priority: "p2",
    assignees: {},
    startAt: "",
    plannedEndAt: "",
    tags: [],
    parent: parent ? { ...parent, code: "" } : null,
    productId: "",
    productNodeId: "",
    projectId: project?.id || "",
    releaseId: "",
    releases: [],
    docUrl: "",
    children: [],
    bugs: [],
    feed: [],
  };

  return (
    <div className="nv-page-flush rq-page">
      <PageContext
        scope={project ? "project" : "global"}
        projectId={project?.id}
        crumbs={[...(project ? [{ label: project.name, href: `/projects/${project.id}` }] : []), { label: "需求池", href: poolHref }, { label: "新建需求" }]}
      />
      <WorkHeader
        crumbs={[
          ...(project ? [{ label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } }] : []),
          { label: "需求池", href: poolHref, icon: "inbox" as const },
          { label: "新建需求" },
        ]}
        actions={<span id="rq-head-actions" className="rq-head-actions" />}
      />
      {allowed ? (
        <RequirementWorkspace mode="create" initial={data} perms={{ edit: true, move: false, bug: false }} lockProject={Boolean(project)} returnHref={poolHref} projectLabel={project?.name} />
      ) : (
        <div className="empty-state">
          <p className="empty-title">没有新建需求的权限</p>
          <p>{project ? "你在这个项目里不能新建需求，" : ""}可联系管理员在「角色权限」里开通。</p>
        </div>
      )}
    </div>
  );
}
