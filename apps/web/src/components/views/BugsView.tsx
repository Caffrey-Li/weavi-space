import { reqCodeOf } from "@pm-collab/core/shared/codes";
import Link from "next/link";
import { loadBugList, findBugListProject } from "@pm-collab/core/bugs/list-page-query";
import { getSession } from "@/lib/auth";
import { BugBoard } from "@/components/board/BugBoard";
import { BugListTable } from "@/components/bugs/BugListTable";
import { NewBugButton } from "@/components/bugs/NewBugButton";
import { BatchSyncButton } from "@/components/feishu/BatchSyncButton";
import { textToHtml } from "@/lib/doc-text";
import { BUG_STATUS } from "@/lib/constants";
import { Pagination } from "@/components/ui/Pagination";
import { parsePageParams } from "@/lib/pagination";
import { ListPageShell } from "@/components/layout/ListPageShell";
import { ListFilters } from "@/components/ui/ListFilters";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { AppliedFilters, HeadPopover, HeadSearch } from "@/components/views/HeadControls";
import { RouteTabs } from "@/components/ui/RouteTabs";
import { appliedFilters } from "@/lib/applied-filters";
import { notFound, redirect } from "next/navigation";

export type BugsSearch = { tab?: string; page?: string; pageSize?: string; status?: string; bug?: string; q?: string; stage?: string };

/** 状态标签（Figma 10）：全部 / 待处理（含重新打开）/ 进行中 / 已解决 / 已关闭（含已取消） */
const BUG_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "", label: "全部", statuses: [] },
  { key: "open", label: "待处理", statuses: ["open", "reopened"] },
  { key: "doing", label: "进行中", statuses: ["in_progress"] },
  { key: "resolved", label: "已解决", statuses: ["resolved"] },
  { key: "closed", label: "已关闭", statuses: ["closed", "cancelled"] },
];

/**
 * Bug 列表 / 看板（Figma 10）。三种入口共用：
 * 全局（全部项目）、项目内（projectId）、我的（mine：指派给我的 Bug，默认待处理 + 进行中）。
 */
export async function BugsView({
  searchParams,
  projectId = "",
  mine = false,
}: {
  searchParams: BugsSearch;
  projectId?: string;
  mine?: boolean;
}) {
  // 旧链接 ?bug=<id>（通知、工作台、需求详情、文档等）统一进 Bug 详情页（11-05）
  if (searchParams.bug) redirect(`/bugs/${encodeURIComponent(searchParams.bug)}`);
  const session = await getSession();
  const basePath = mine ? "/my/bugs" : projectId ? `/projects/${projectId}/bugs` : "/bugs";
  const tab = searchParams.tab === "board" && !searchParams.bug ? "board" : "list";
  const { page, pageSize } = parsePageParams(searchParams);
  const statusFilter = BUG_STATUS.some((s) => s.key === searchParams.status) ? searchParams.status! : "";
  const stage = BUG_TABS.find((t) => t.key && t.key === searchParams.stage)?.key || "";
  const q = searchParams.q?.trim() || "";

  const { bugs, total, byStatus, projects, perms, focused } = await loadBugList(session, { mine, projectId, q, statusFilter, stage, stageStatuses: BUG_TABS.find((t) => t.key === stage)?.statuses || [], tab, page, pageSize, focusedId: searchParams.bug });
  const statusCount = new Map(byStatus.map((g) => [g.status, g._count._all]));
  const tabCount = (t: (typeof BUG_TABS)[number]) =>
    t.key ? t.statuses.reduce((a, s) => a + (statusCount.get(s) || 0), 0) : byStatus.reduce((a, g) => a + g._count._all, 0);

  const toCard = (b: (typeof bugs)[number]) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    severity: b.severity,
    boardOrder: b.boardOrder,
    reopenCount: b.reopenCount,
    projectId: b.projectId,
    projectName: b.project?.name,
    projectIconUrl: b.project?.iconUrl,
    assigneeId: b.assigneeId,
    assigneeName: b.assignee?.name,
    assigneeAvatarUrl: b.assignee?.avatarUrl,
    // 旧数据只有处理人：当作后端负责人
    frontendId: b.frontendId,
    frontendName: b.frontend?.name ?? null,
    frontendAvatarUrl: b.frontend?.avatarUrl ?? null,
    backendId: b.backendId || (!b.frontendId ? b.assigneeId : null),
    backendName: b.backend?.name ?? (!b.frontendId ? b.assignee?.name ?? null : null),
    backendAvatarUrl: b.backend?.avatarUrl ?? (!b.frontendId ? b.assignee?.avatarUrl ?? null : null),
    requirementId: b.requirementId,
    requirementTitle: b.requirement?.title,
    requirementCode: b.requirement
      ? reqCodeOf(b.requirement)
      : null,
    // 编辑弹窗的描述是富文本：旧的纯文本转成段落
    summary: b.descriptionHtml || (b.summary ? textToHtml(b.summary) : ""),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  });
  let cards = bugs.map(toCard);
  // 从需求详情点进来的 Bug 可能不在当前页：放到第一行，便于直接编辑
  if (focused && !cards.some((c) => c.id === focused.id)) cards = [toCard(focused), ...cards];
  const project = await findBugListProject(projectId);
  if (projectId && !project) notFound();
  const hasFilters = Boolean(q || statusFilter || stage);

  const href = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { tab: tab === "board" ? "board" : undefined, q: q || undefined, stage: stage || undefined, status: statusFilter || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const str = sp.toString();
    return str ? `${basePath}?${str}` : basePath;
  };
  // 删光最后一页后回到现在的最后一页，不停在空页上
  if (tab === "list" && total > 0 && (page - 1) * pageSize >= total) {
    const last = Math.ceil(total / pageSize);
    redirect(href({ page: last > 1 ? String(last) : undefined, pageSize: searchParams.pageSize }));
  }
  const listBase = (() => {
    const sp = new URLSearchParams({ tab: "list" });
    if (q) sp.set("q", q);
    return `${basePath}?${sp.toString()}`;
  })();

  const crumbs: WorkCrumb[] = mine
    ? [{ label: "我的 Bug", icon: "bug" }]
    : project
      ? [
          { label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } },
          { label: "Bug", icon: "bug" },
        ]
      : [{ label: "Bug", icon: "bug" }];

  const header = (
    <WorkHeader
      crumbs={crumbs}
      count={tabCount(BUG_TABS[0])}
      actions={
        <>
          <HeadSearch value={q} placeholder="搜索 Bug 标题" keep={{ tab: tab === "board" ? "board" : undefined, stage: stage || undefined }} />
          <HeadPopover label="筛选" icon="filter" caret={false} active={Boolean(statusFilter)} width={260}>
            <ListFilters
              ariaLabel="筛选 Bug"
              selects={[
                ...(projectId || mine
                  ? []
                  : [
                      {
                        name: "project",
                        label: "项目",
                        value: "",
                        allLabel: "全部项目",
                        options: projects.map((p) => ({ value: p.id, label: p.name })),
                      },
                    ]),
                {
                  name: "status",
                  label: "具体状态",
                  value: statusFilter,
                  allLabel: "全部状态",
                  options: BUG_STATUS.map((s) => ({ value: s.key, label: s.label })),
                },
              ]}
              hidden={{ tab: tab === "board" ? "board" : undefined, q: q || undefined, pageSize: searchParams.pageSize }}
              hasFilters={hasFilters}
              clearHref={tab === "board" ? `${basePath}?tab=board` : basePath}
            />
          </HeadPopover>
          <HeadPopover label="显示" icon="display" caret={false} width={220}>
            <div className="nv-pop-label">布局</div>
            <div className="seg" role="group" aria-label="布局">
              <Link href={href({ tab: undefined })} aria-pressed={tab === "list"} className="seg-btn">
                列表
              </Link>
              <Link href={href({ tab: "board", stage: undefined })} aria-pressed={tab === "board"} className="seg-btn">
                看板
              </Link>
            </div>
          </HeadPopover>
          {perms["bugs.edit"] && !mine ? <BatchSyncButton target="bug" projectId={projectId || undefined} /> : null}
          {perms["bugs.edit"] ? (
            <NewBugButton defaultProjectId={projectId || undefined} icon={false} className="btn-primary nv-head-btn" />
          ) : null}
        </>
      }
    />
  );

  const applied = appliedFilters(basePath, { tab: tab === "board" ? "board" : undefined, q, stage, status: statusFilter }, [
    { key: "q", field: "标题包含", label: (v) => v },
    { key: "status", field: "状态", label: (v) => BUG_STATUS.find((s) => s.key === v)?.label },
  ]);

  const toolbar = (
    <>
      {tab === "list" ? (
        <RouteTabs
          label="Bug 状态"
          current={stage}
          tabs={BUG_TABS.map((t) => ({ key: t.key, label: t.label, href: href({ stage: t.key || undefined, status: undefined, page: undefined }), count: tabCount(t) }))}
        />
      ) : null}
      <AppliedFilters items={applied} clearHref={tab === "board" ? `${basePath}?tab=board` : basePath} />
    </>
  );

  if (tab === "board") {
    return (
      <ListPageShell header={header} toolbar={applied.length ? toolbar : undefined} className="board-page">
        <BugBoard initialCards={cards} key={`${projectId}|${q}|${statusFilter}`} canEdit={perms["bugs.edit"]} canDelete={perms["bugs.delete"]} listBase={listBase} />
      </ListPageShell>
    );
  }

  return (
    <ListPageShell
      header={header}
      toolbar={toolbar}
      footer={total > pageSize ? <Pagination total={total} page={page} pageSize={pageSize} syncUrl /> : undefined}
    >
      {cards.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">{hasFilters ? "没有符合条件的 Bug" : "还没有 Bug"}</p>
          <p>
            {hasFilters ? (
              <>
                条件已保留。{" "}
                <Link href={basePath} className="text-link">
                  清除筛选
                </Link>
              </>
            ) : mine ? (
              "目前没有指派给你的 Bug。"
            ) : perms["bugs.edit"] ? (
              "发现问题时点右上角「新建 Bug」，可关联到具体需求。"
            ) : (
              "当前没有需要处理的缺陷。"
            )}
          </p>
        </div>
      ) : (
        <BugListTable rows={cards} canEdit={perms["bugs.edit"]} canDelete={perms["bugs.delete"]} focusId={searchParams.bug} hideProject={Boolean(projectId)} />
      )}
    </ListPageShell>
  );
}
