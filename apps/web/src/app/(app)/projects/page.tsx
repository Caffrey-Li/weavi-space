import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { loadProjectsPageData } from "@pm-collab/core/projects/list-page-query";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { ProjectCard, type ProjectCardData } from "@/components/projects/ProjectCard";
import { ListFilters } from "@/components/ui/ListFilters";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { HeadPopover, HeadSearch } from "@/components/views/HeadControls";
import { PROJECT_STATUS_LABELS } from "@/lib/constants";

const SORTS = { created: "创建时间", name: "名称" } as const;

/** 项目（Figma 03）：功能区（搜索 · 排序 · 筛选 · 新建项目）+ 卡片网格 */
export default async function ProjectsPage(
  props: { searchParams: Promise<{ q?: string; status?: string; sort?: string }> }
) {
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim() || "";
  const status = PROJECT_STATUS_LABELS[searchParams.status || ""] ? searchParams.status! : "";
  const sort: keyof typeof SORTS = searchParams.sort === "name" ? "name" : "created";
  const session = await getSession();
  const canCreate = session ? await can(session, "project.edit") : false;

  const { projects, progress } = await loadProjectsPageData(session, { q, status, sort });
  const toCard = (p: (typeof projects)[number]): ProjectCardData => {
    const pm = p.members.find((m) => m.role === "pm")?.user || p.createdBy;
    return {
      id: p.id,
      name: p.name,
      key: p.key,
      iconUrl: p.iconUrl,
      coverUrl: p.coverUrl,
      status: p.status,
      ...(progress.get(p.id) || { done: 0, all: 0 }),
      owner: pm ? { name: pm.name, avatarUrl: pm.avatarUrl } : null,
      joined: Boolean(session && p.members.some((m) => m.userId === session.id)),
      members: p.members.map((m) => ({ id: m.id, name: m.user.name, avatarUrl: m.user.avatarUrl })),
    };
  };
  const current = projects.filter((p) => p.status !== "archived");
  const archived = projects.filter((p) => p.status === "archived");
  const hasFilters = Boolean(q || status);
  const sortHref = (() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (sort === "created") sp.set("sort", "name");
    const qs = sp.toString();
    return qs ? `/projects?${qs}` : "/projects";
  })();

  return (
    <div className="nv-page-flush">
      <WorkHeader
        crumbs={[{ label: "项目" }]}
        count={current.length}
        actions={
          <>
            <HeadSearch value={q} placeholder="搜索项目名称" keep={{ status, sort: sort === "name" ? "name" : undefined }} />
            <Link href={sortHref} className="btn-secondary nv-head-btn" title="切换排序">
              <ArrowUpDown size={14} aria-hidden="true" />
              {SORTS[sort]}
            </Link>
            <HeadPopover label="筛选项目" icon="filter" iconOnly active={Boolean(status)} width={240}>
              <ListFilters
                ariaLabel="筛选项目"
                hidden={{ q, sort: sort === "name" ? "name" : undefined }}
                selects={[
                  {
                    name: "status",
                    label: "项目状态",
                    value: status,
                    allLabel: "全部状态",
                    options: Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
                  },
                ]}
                hasFilters={hasFilters}
                clearHref="/projects"
              />
            </HeadPopover>
            {canCreate ? <NewProjectButton className="btn-primary nv-head-btn" /> : null}
          </>
        }
      />
      <div className="nv-page-body">
        {projects.length === 0 ? (
          <p className="empty-inline">
            {hasFilters ? "没有符合条件的项目，条件已保留。" : canCreate ? "还没有项目，点右上角「新建项目」开始。" : "还没有项目。"}
          </p>
        ) : null}

        {current.length ? (
          <div className="nv-pcard-grid">
            {current.map((p) => (
              <ProjectCard key={p.id} p={toCard(p)} />
            ))}
          </div>
        ) : null}

        {archived.length ? (
          <section className="page-section" aria-labelledby="archived-title">
            <div className="section-head">
              <h2 id="archived-title" className="section-title">
                已归档<span className="section-count">{archived.length}</span>
              </h2>
            </div>
            <div className="nv-pcard-grid">
              {archived.map((p) => (
                <ProjectCard key={p.id} p={toCard(p)} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
