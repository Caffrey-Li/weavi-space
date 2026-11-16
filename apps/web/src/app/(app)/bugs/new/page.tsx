import { loadNewBugPage } from "@pm-collab/core/bugs/new-page-query";
import { getSession } from "@/lib/auth";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { BugCreateWorkspace } from "@/components/bugs/BugCreateWorkspace";

/** 新建 Bug 全页（Figma 28）：?project=<id> 锁定项目；?requirement=<id> 从需求「关联 Bug」进入，带上需求和功能模块 */
export default async function NewBugPage(
  props: { searchParams: Promise<{ project?: string; requirement?: string }> }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const { requirement, project, allowed } = await loadNewBugPage(session, searchParams);
  const listHref = project ? `/projects/${project.id}/bugs` : "/bugs";
  const crumbs: WorkCrumb[] = [
    ...(project ? [{ label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } }] : []),
    { label: "Bug", href: listHref, icon: "bug" as const },
    { label: "新建 Bug" },
  ];

  return (
    <div className="nv-page-flush rq-page">
      <PageContext
        scope={project ? "project" : "global"}
        projectId={project?.id}
        crumbs={[...(project ? [{ label: project.name, href: `/projects/${project.id}` }] : []), { label: "Bug", href: listHref }, { label: "新建 Bug" }]}
      />
      {allowed || !project ? (
        <BugCreateWorkspace
          crumbs={crumbs}
          initialProject={project}
          lockProject={Boolean(project || requirement)}
          returnHref={requirement ? `/requirements/${requirement.id}` : listHref}
          initial={{
            projectId: project?.id || "",
            requirement:
              requirement && requirement.projectId === project?.id
                ? { id: requirement.id, title: requirement.title, code: requirement.project ? `${requirement.project.key}-${requirement.id.slice(-4).toUpperCase()}` : "" }
                : null,
            productId: requirement?.productId || "",
            productNodeId: requirement?.productNodeId || "",
          }}
        />
      ) : (
        <>
        <WorkHeader crumbs={crumbs} />
        <div className="empty-state">
          <p className="empty-title">没有提交 Bug 的权限</p>
          <p>你在这个项目里不能提交 Bug，可联系管理员在「角色权限」里开通「处理 Bug」。</p>
        </div>
        </>
      )}
    </div>
  );
}
