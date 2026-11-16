import Link from "next/link";
import { notFound } from "next/navigation";
import { NewRequirementButton } from "@/components/requirements/NewRequirementButton";
import { BatchSyncButton } from "@/components/feishu/BatchSyncButton";
import { RequirementFilters } from "@/components/requirements/RequirementFilters";
import { RequirementPoolTable } from "@/components/requirements/RequirementPoolTable";
import { StageTabs } from "@/components/requirements/StageTabs";
import { Pagination } from "@/components/ui/Pagination";
import { ListPageShell } from "@/components/layout/ListPageShell";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { AppliedFilters, DisplayPanel, HeadPopover, LayoutToggle } from "@/components/views/HeadControls";
import { loadRequirementsPool, toPoolRows } from "@/lib/requirements-pool";
import { appliedFilters } from "@/lib/applied-filters";
import { REQ_STAGE_TABS } from "@/lib/constants";
import { getSession } from "@/lib/auth";
import { canMany } from "@/lib/permissions";

export type PoolSearch = {
  q?: string;
  project?: string;
  status?: string;
  stage?: string;
  page?: string;
  pageSize?: string;
  product?: string;
  productNode?: string;
};

/**
 * 需求列表页（Figma 02 我的待办 / 05 项目需求池 / 07 需求池）：
 * 功能区 44（面包屑 + 总数 · 筛选 ▾ 显示 ▾ 新建需求）→ 阶段标签 → 筛选条 → 按状态分组的列表。
 */
export async function PoolView({
  searchParams,
  mine = false,
  projectId,
}: {
  searchParams: PoolSearch;
  mine?: boolean;
  projectId?: string;
}) {
  const session = await getSession();
  const [data, perms] = await Promise.all([
    loadRequirementsPool({
      searchParams: { ...searchParams, mine: mine ? "1" : undefined },
      userId: session?.id,
      lockedProjectId: projectId,
    }),
    canMany(session, ["requirements.create", "board.move"] as const, projectId),
  ]);
  if (projectId && !data.lockedProject) notFound();
  const project = data.lockedProject;
  const basePath = project ? `/projects/${project.id}/requirements` : mine ? "/my/requirements" : "/requirements";
  const filtered = Boolean(data.q || data.proposer || (!project && data.project) || data.status || data.stage || data.productFilter || data.productNodeFilter);
  const projectName = (id: string) => (id === "__none__" ? "未归属项目" : data.projects.find((p) => p.id === id)?.name);
  const applied = appliedFilters(
    basePath,
    {
      q: data.q,
      project: project ? undefined : data.project,
      status: data.status,
      stage: data.stage,
      proposer: data.proposer || undefined,
      pageSize: searchParams.pageSize,
      product: data.productFilter?.id,
      productNode: data.productNodeFilter?.id,
    },
    [
      { key: "proposer", field: "提出人", label: () => "我提出的" },
      { key: "product", field: "产品", label: () => data.productFilter?.name },
      { key: "productNode", field: "功能模块", label: () => data.productNodeFilter?.name },
      { key: "q", field: "标题包含", label: (v) => v },
      ...(project ? [] : [{ key: "project", field: "项目", label: projectName }]),
      { key: "status", field: "状态", label: (v) => v },
      ...(mine || project ? [{ key: "stage", field: "阶段", label: (v: string) => REQ_STAGE_TABS.find((t) => t.key === v)?.label }] : []),
    ],
  );
  const crumbs: WorkCrumb[] = project
    ? [
        { label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } },
        { label: "需求", icon: "list" },
      ]
    : [{ label: mine ? "我的待办" : "需求池" }];
  const canCreate = perms["requirements.create"];
  const createProps = canCreate ? { defaultProjectId: project?.id, lockProject: Boolean(project) } : undefined;

  return (
    <ListPageShell
      header={
        <>
          <PageContext
            crumbs={
              project
                ? [
                    { label: project.name, href: `/projects/${project.id}` },
                    { label: "需求池" },
                  ]
                : [{ label: mine ? "我的待办" : "需求池" }]
            }
          />
          <WorkHeader
            crumbs={crumbs}
            count={data.total}
            actions={
              <>
                {project ? (
                  <LayoutToggle listHref={basePath} boardHref={`/projects/${project.id}/board`} current="list" />
                ) : null}
                <HeadPopover label="筛选" icon="filter" caret={Boolean(project)}>
                  <RequirementFilters
                    q={data.q}
                    stage={data.stage || undefined}
                    pageSize={searchParams.pageSize}
                    project={project ? project.id : data.project}
                    status={data.status}
                    proposer={data.proposer}
                    projects={[...data.projects, { id: "__none__", name: "未归属项目" }]}
                    statuses={data.statuses}
                    hasFilters={filtered}
                    clearHref={basePath}
                    showProjectFilter={!project}
                  />
                </HeadPopover>
                <HeadPopover label="显示" icon="display" caret={Boolean(project)}>
                  <DisplayPanel props={project ? ["status", "priority", "owner", "due"] : ["status", "priority", "owner", "due", "project"]} />
                </HeadPopover>
                {canCreate && !mine ? <BatchSyncButton target="requirement" projectId={project?.id} /> : null}
                {canCreate && !mine ? (
                  <NewRequirementButton defaultProjectId={project?.id} lockProject={Boolean(project)} icon={null} className="btn-primary nv-head-btn" />
                ) : null}
              </>
            }
          />
        </>
      }
      toolbar={
        (mine || project) && !applied.length ? null : (
          <>
            {!mine && !project ? (
              <StageTabs
                basePath={basePath}
                stage={data.stage}
                counts={data.stageCounts}
                keep={{
                  project: project ? undefined : data.project || undefined,
                  q: data.q || undefined,
                  pageSize: searchParams.pageSize,
                  product: data.productFilter?.id,
                  productNode: data.productNodeFilter?.id,
                }}
              />
            ) : null}
            <AppliedFilters items={applied} clearHref={basePath} />
            {data.stageConflict ? (
              <p className="notice nv-notice" role="status">
                所选状态不属于当前阶段，因此没有结果。可切换阶段或清除状态筛选。
              </p>
            ) : null}
          </>
        )
      }
      footer={
        data.total > data.pageSize ? <Pagination total={data.total} page={data.page} pageSize={data.pageSize} syncUrl /> : undefined
      }
    >
      <RequirementPoolTable
        rows={toPoolRows(data.items)}
        showProject={!project}
        hideProps={mine ? ["owner"] : []}
        canMove={perms["board.move"]}
        createProps={createProps}
        emptyTitle={filtered ? "没有符合条件的需求" : mine ? "没有待办需求" : project ? "本项目还没有需求" : "还没有需求"}
        emptyBody={
          filtered ? (
            <>
              当前条件下没有结果，条件已保留。{" "}
              <Link href={basePath} className="text-brand-600 hover:underline">
                清除筛选
              </Link>
            </>
          ) : mine ? (
            "你负责的需求会出现在这里。"
          ) : canCreate ? (
            "新建第一个需求，开始规划迭代。"
          ) : (
            "目前没有需求。"
          )
        }
      />
    </ListPageShell>
  );
}
