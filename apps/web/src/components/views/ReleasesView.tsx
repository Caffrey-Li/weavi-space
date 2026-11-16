import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpDown, CalendarClock, CalendarDays } from "lucide-react";
import { loadReleaseList } from "@pm-collab/core/releases/list-page-query";
import { getSession } from "@/lib/auth";
import { ReleaseStatusBadge } from "@/components/ui/StatusBadge";
import { fmtMonthDay } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import { parsePageParams } from "@/lib/pagination";
import { ListPageShell } from "@/components/layout/ListPageShell";
import { NewReleaseButton } from "@/components/releases/ReleaseForm";
import { ReleaseRowMenu } from "@/components/releases/ReleaseRowMenu";
import { ListFilters } from "@/components/ui/ListFilters";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { HeadPopover, HeadSearch } from "@/components/views/HeadControls";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Avatar } from "@/components/ui/Avatar";
import { RELEASE_STATUS } from "@/lib/constants";
import { HotfixReleaseButton } from "@/components/releases/HotfixReleaseButton";
import { ReleaseScheduleButton } from "@/components/releases/ReleaseScheduleButton";
import { ReleaseKindBadge } from "@/components/releases/ReleaseKindBadge";
import {
  RELEASE_KINDS,
  describeReleaseSchedule,
  toConfig,
} from "@/lib/release-schedule";

export type ReleasesSearch = { page?: string; pageSize?: string; status?: string; q?: string; sort?: string; kind?: string };

/** 发版列表（Figma 08）：每行 进度环 · 版本名 · 项目 · 计划日期 · 状态 · 需求数 · 负责人 · ⋯ */
export async function ReleasesView({ searchParams, projectId = "" }: { searchParams: ReleasesSearch; projectId?: string }) {
  const session = await getSession();
  const { page, pageSize } = parsePageParams(searchParams);
  const basePath = projectId ? `/projects/${projectId}/releases` : "/releases";
  const q = searchParams.q?.trim() || "";
  const asc = searchParams.sort === "asc";
  const status = searchParams.status === "open" || RELEASE_STATUS[searchParams.status || ""] ? searchParams.status! : "";
  const kind = RELEASE_KINDS[searchParams.kind || ""] ? searchParams.kind! : "";
  const { total, releases, projects, perms, project, schedule } = await loadReleaseList(session, { projectId, status, q, kind, asc, page, pageSize });
  if (projectId && !project) notFound();
  const hasFilters = Boolean(q || status || kind);
  const keep = { q: q || undefined, status: status || undefined, kind: kind || undefined, pageSize: searchParams.pageSize };
  const sortHref = (() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) sp.set(k, v);
    if (!asc) sp.set("sort", "asc");
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  })();

  return (
    <ListPageShell
      header={
        <>
          <PageContext
            crumbs={
              project
                ? [{ label: project.name, href: `/projects/${project.id}` }, { label: "发版" }]
                : [{ label: "发版" }]
            }
          />
          <WorkHeader
            crumbs={
              project
                ? [
                    { label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } },
                    { label: "发版", icon: "rocket" },
                  ]
                : [{ label: "发版" }]
            }
            count={total}
            actions={
              <>
                <HeadSearch value={q} placeholder="搜索版本号或名称" keep={{ status: status || undefined, kind: kind || undefined, sort: asc ? "asc" : undefined }} />
                <HeadPopover label="筛选" icon="filter" caret={false} active={Boolean(status || kind)} width={260}>
                  <ListFilters
                    ariaLabel="筛选发版"
                    selects={[
                      ...(projectId
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
                        label: "状态",
                        value: status,
                        allLabel: "全部状态",
                        options: [
                          { value: "open", label: "未上线（规划 / 冻结 / 发布中）" },
                          ...Object.entries(RELEASE_STATUS).map(([value, s]) => ({ value, label: s.label })),
                        ],
                      },
                      {
                        name: "kind",
                        label: "类型",
                        value: kind,
                        allLabel: "全部类型",
                        options: Object.entries(RELEASE_KINDS).map(([value, k]) => ({ value, label: k.label })),
                      },
                    ]}
                    hidden={{ pageSize: searchParams.pageSize, q: q || undefined, sort: asc ? "asc" : undefined }}
                    hasFilters={hasFilters}
                    clearHref={basePath}
                  />
                </HeadPopover>
                <Link href={sortHref} className="btn-secondary nv-head-btn" title={asc ? "按计划日期升序" : "按计划日期降序"}>
                  <ArrowUpDown size={14} aria-hidden="true" />
                  计划日期
                </Link>
                {perms["releases.manage"] && projectId ? (
                  <ReleaseScheduleButton projectId={projectId} initial={schedule?.enabled ? toConfig(schedule) : null} />
                ) : null}
                {perms["releases.manage"] ? <HotfixReleaseButton defaultProjectId={projectId || undefined} /> : null}
                {perms["releases.manage"] ? (
                  <NewReleaseButton defaultProjectId={projectId || undefined} className="btn-primary nv-head-btn" />
                ) : null}
              </>
            }
          />
          {schedule?.enabled ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-nv-border-subtle px-5 py-2 text-sm text-nv-text-secondary">
              <CalendarClock size={14} aria-hidden="true" />
              <span>
                固定发版：<b className="font-medium text-nv-text-primary">{describeReleaseSchedule(toConfig(schedule))}</b>
              </span>
              <span>· 自动保留未来 {schedule.horizon} 期</span>
              {schedule.freezeDays ? <span>· 上线前 {schedule.freezeDays} 天自动冻结</span> : null}
            </p>
          ) : null}
        </>
      }
      footer={total > pageSize ? <Pagination total={total} page={page} pageSize={pageSize} syncUrl /> : undefined}
    >
      {releases.length === 0 ? (
        <div className="empty-state" role="status">
          <p className="empty-title">{hasFilters ? "没有符合条件的版本" : "还没有版本"}</p>
          <p className="mt-2 text-neutral-500">
            {hasFilters ? (
              <Link href={basePath} className="text-link">
                清除筛选
              </Link>
            ) : perms["releases.manage"] ? (
              "点右上角「新建版本」规划第一个版本。"
            ) : (
              "项目经理规划版本后会显示在这里。"
            )}
          </p>
        </div>
      ) : (
        <ul className="nv-list" aria-label={`发版列表，共 ${total} 个`}>
          {releases.map((r) => {
            const n = r.items.length;
            const done = r.items.filter((i) => i.requirement.status === "online").length;
            const pct = r.status === "released" ? 100 : n ? (done / n) * 100 : 0;
            const end = r.status === "released" && r.releasedAt ? r.releasedAt : r.plannedAt;
            return (
              <li key={r.id} className="nv-row nv-release-row">
                <ProgressRing pct={pct} />
                <span className="nv-release-main">
                  <Link href={`/releases/${r.id}`} className="nv-row-link">
                    v{r.version}
                    {r.title ? ` · ${r.title}` : ""}
                  </Link>
                  <span className="nv-release-sub">
                    {r.project.name}
                    <ReleaseKindBadge kind={r.kind} />
                  </span>
                </span>
                <span className="nv-row-props">
                  {end ? (
                    <span className="pp" title="开始 → 计划上线">
                      <CalendarDays size={14} aria-hidden="true" />
                      {fmtMonthDay(r.createdAt)} → {fmtMonthDay(end)}
                    </span>
                  ) : null}
                  <ReleaseStatusBadge status={r.status} />
                  <span className="pp">需求 {n}</span>
                  {r.creator ? (
                    <span title={`负责人 ${r.creator.name}`}>
                      <Avatar name={r.creator.name} src={r.creator.avatarUrl} size={20} />
                    </span>
                  ) : null}
                </span>
                <span className="nv-row-more">
                  <ReleaseRowMenu id={r.id} name={`v${r.version}`} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </ListPageShell>
  );
}
