import { requireProjectPage } from "@/lib/page-guard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findProjectOverview, loadProjectOverviewData } from "@pm-collab/core/projects/detail-page-query";
import { delayDays } from "@/lib/utils";
import { ProjectStatusBadge } from "@/components/ui/StatusBadge";
import { REQ_STAGE_TABS, normalizeReqStatus } from "@/lib/constants";
import { getSession } from "@/lib/auth";
import { EditProjectButton } from "@/components/projects/EditProjectButton";
import { ProjectLifecycleMenu } from "@/components/projects/ProjectLifecycleMenu";
import { ProjectResources } from "@/components/projects/ProjectResources";
import { PageContext } from "@/components/layout/PageContext";
import { ShareProjectButton } from "@/components/projects/ShareProjectButton";
import { RequirementPoolTable } from "@/components/requirements/RequirementPoolTable";
import { toPoolRows } from "@/lib/requirements-pool";
import { PlanTimeline } from "@/components/plans/PlanList";
import { ProjectFlowButton } from "@/components/projects/ProjectFlowButton";
import { ProjectGitButton } from "@/components/git/ProjectGitButton";
import { flowForProject } from "@pm-collab/core/flow/service";
import { prisma } from "@/lib/prisma";
import { REQ_STATUS } from "@/lib/constants";

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireProjectPage(params.id);
  const p = await findProjectOverview(params.id);
  if (!p) notFound();

  const session = await getSession();
  const { perms, statusCounts, openBugs, blockers, recent, plans } = await loadProjectOverviewData(session, p.id);
  const byStatus = new Map<string, number>();
  for (const s of statusCounts) {
    const k = normalizeReqStatus(s.status);
    byStatus.set(k, (byStatus.get(k) || 0) + s._count);
  }
  const cancelled = byStatus.get("cancelled") || 0;
  const totalAll = Array.from(byStatus.values()).reduce((a, n) => a + n, 0);
  // 完成率只计「已上线」，分母不含已取消
  const effective = totalAll - cancelled;
  const done = byStatus.get("online") || 0;
  const pct = effective > 0 ? Math.round((done / effective) * 100) : 0;
  const d = delayDays(p.plannedEndAt, p.actualEndAt);
  const late = d != null && d > 0 && !p.actualEndAt;

  const daysLeft = p.plannedEndAt ? Math.ceil((p.plannedEndAt.getTime() - Date.now()) / 86400000) : null;
  const kpis = [
    { label: "上线完成率", value: `${pct}%`, note: `已上线 ${done} / ${effective}`, tone: "accent" },
    {
      label: "需求总数",
      value: String(totalAll),
      note: `开发中 ${byStatus.get("dev_in_progress") || 0} · 测试中 ${byStatus.get("test_in_progress") || 0}`,
      tone: "plain",
    },
    { label: "未关闭 Bug", value: String(openBugs), note: openBugs ? `其中阻塞 ${blockers}` : "暂无未关闭 Bug", tone: openBugs ? "warning" : "plain", href: `/projects/${p.id}/bugs` },
    {
      label: "计划交付",
      value: p.plannedEndAt ? `${p.plannedEndAt.getMonth() + 1}.${String(p.plannedEndAt.getDate()).padStart(2, "0")}` : "未设置",
      note: p.plannedEndAt
        ? p.actualEndAt
          ? "已完成交付"
          : late
            ? `已延期 ${d} 天`
            : `还有 ${daysLeft} 天`
        : "可在「编辑项目」中设置",
      tone: late ? "danger" : "plain",
    },
  ];
  // 阶段分布：需求 / 开发 / 测试 / 已上线（不含已取消）
  const stages = REQ_STAGE_TABS.filter((t) => t.key).map((t) => ({
    key: t.key,
    label: t.label,
    n: t.statuses.reduce((a, s) => a + (byStatus.get(s) || 0), 0),
  }));
  const stageTotal = stages.reduce((a, s) => a + s.n, 0);
  // T43 阶段式：里程碑 = 每一段有多少需求已经走过，计划完成日取该段任务的最晚截止
  const flow = await flowForProject(p.id);
  const ORDER = REQ_STATUS.map((x) => x.key as string);
  const reached = (first: string) => ORDER.filter((k) => k !== "cancelled" && ORDER.indexOf(k) >= ORDER.indexOf(first)).reduce((a, k) => a + (byStatus.get(k) || 0), 0);
  const milestones =
    flow.mode === "phase"
      ? await Promise.all(
          [
            { label: "需求确认", first: flow.designStage ? "req_design" : "dev_todo", kinds: [] as string[] },
            ...(flow.designStage ? [{ label: "设计完成", first: "dev_todo", kinds: ["design"] }] : []),
            { label: "开发完成", first: "dev_done", kinds: ["frontend", "backend", "dev"] },
            { label: "测试完成", first: "test_done", kinds: ["test"] },
            { label: "上线", first: "online", kinds: ["release"] },
          ].map(async (m) => {
            const due = m.kinds.length ? await prisma.requirementTask.aggregate({ where: { kind: { in: m.kinds }, status: { not: "cancelled" }, requirement: { projectId: p.id, deletedAt: null } }, _max: { dueAt: true } }) : null;
            const n = reached(m.first);
            return { ...m, n, pct: effective ? Math.round((n / effective) * 100) : 0, due: due?._max.dueAt ?? null };
          }),
        )
      : [];
  const STAGE_COLOR: Record<string, string> = {
    req: "var(--nv-state-req)",
    dev: "var(--nv-state-dev)",
    test: "var(--nv-state-test)",
    online: "var(--nv-state-done)",
  };

  return (
    <div className="page-overview is-wide nv-project-overview">
      <PageContext crumbs={[{ label: "项目", href: "/projects" }, { label: p.name }]} />
      {p.coverUrl ? <div className="nv-project-cover" style={{ backgroundImage: `url("${p.coverUrl}")` }} aria-hidden="true" /> : null}
      <header className="nv-overview-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{p.name}</h1>
            {p.status !== "active" ? <ProjectStatusBadge status={p.status} /> : null}
          </div>
          <p className="page-summary">{p.description || p.systemName}</p>
        </div>
        {perms["project.edit"] ? (
          <div className="flex items-center gap-2">
          <ShareProjectButton projectId={p.id} projectName={p.name} />
          <EditProjectButton
            className="btn-secondary nv-section-btn"
            withIcon
            project={{
              id: p.id,
              name: p.name,
              key: p.key,
              systemName: p.systemName,
              enterpriseId: p.enterpriseId,
              description: p.description,
              status: p.status,
              plannedEndAt: p.plannedEndAt,
              actualEndAt: p.actualEndAt,
              launchNotes: p.launchNotes,
              iconUrl: p.iconUrl,
              coverUrl: p.coverUrl,
              productId: p.productId,
            }}
          />
          <ProjectLifecycleMenu id={p.id} name={p.name} status={p.status} />
          </div>
        ) : null}
      </header>

      <section className="kpi-grid nv-kpis-project" aria-label="项目指标">
        {kpis.map((k) => {
          const body = (
            <>
              <span className="kpi-label">{k.label}</span>
              <span className={`kpi-value kpi-${k.tone}`}>{k.value}</span>
              <span className="kpi-note">{k.note}</span>
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className="kpi-card">
              {body}
            </Link>
          ) : (
            <div key={k.label} className="kpi-card">
              {body}
            </div>
          );
        })}
      </section>

      <section className="page-section" aria-labelledby="stage-title">
        <div className="section-head">
          <h2 id="stage-title" className="section-title">阶段分布</h2>
          <div className="flex gap-2">
            <ProjectGitButton projectId={p.id} />
            <ProjectFlowButton projectId={p.id} />
          </div>
        </div>
        <div className="nv-stagebar" role="img" aria-label={stages.map((s) => `${s.label} ${s.n}`).join("，")}>
          {stageTotal ? (
            stages
              .filter((s) => s.n)
              .map((s) => <span key={s.key} style={{ flexGrow: s.n, background: STAGE_COLOR[s.key] }} />)
          ) : (
            <span style={{ flexGrow: 1, background: "var(--nv-bg-sunken)" }} />
          )}
        </div>
        <ul className="nv-stage-legend">
          {stages.map((s) => (
            <li key={s.key}>
              <i style={{ background: STAGE_COLOR[s.key] }} aria-hidden="true" />
              {s.label}
              <b>{s.n}</b>
            </li>
          ))}
        </ul>
      </section>

      {milestones.length ? (
        <section className="page-section" aria-labelledby="ms-title">
          <div className="section-head">
            <h2 id="ms-title" className="section-title">里程碑</h2>
            <span className="nv-flow-meta">阶段式研发 · 按需求走过每一段的比例</span>
          </div>
          <ol className="nv-milestones">
            {milestones.map((m) => (
              <li key={m.label} data-done={m.pct === 100 && effective > 0 ? "true" : undefined}>
                <b>{m.label}</b>
                <span className="nv-ms-bar" aria-hidden="true">
                  <i style={{ width: `${m.pct}%` }} />
                </span>
                <span>
                  {m.n} / {effective} · {m.pct}%
                </span>
                <span className="nv-flow-meta">{m.due ? `计划 ${m.due.getMonth() + 1}.${String(m.due.getDate()).padStart(2, "0")}` : "未排期"}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {plans.length ? (
        <section className="page-section" aria-labelledby="plans-title">
          <div className="section-head">
            <h2 id="plans-title" className="section-title">
              上线计划<span className="section-count">{plans.length}</span>
            </h2>
            <Link href={`/projects/${p.id}/plans`} className="btn-secondary nv-section-btn">
              查看全部
            </Link>
          </div>
          <PlanTimeline plans={plans} />
        </section>
      ) : null}

      <section className="page-section" aria-labelledby="recent-title">
        <div className="section-head">
          <h2 id="recent-title" className="section-title">
            近期需求<span className="section-count">{totalAll}</span>
          </h2>
          <Link href={`/projects/${p.id}/requirements`} className="btn-secondary nv-section-btn">
            查看全部
          </Link>
        </div>
        <div className="nv-overview-list">
          <RequirementPoolTable
            rows={toPoolRows(recent)}
            showProject={false}
            flat
            canMove={perms["board.move"]}
            emptyTitle="还没有需求"
            emptyBody={
              <>
                可在 <Link href={`/projects/${p.id}/requirements`} className="text-link">项目需求池</Link> 新建
              </>
            }
          />
        </div>
      </section>

      <ProjectResources
        projectId={p.id}
        resources={p.resources.map((r) => ({ id: r.id, name: r.name, url: r.url, sortOrder: r.sortOrder }))}
        canEdit={perms["project.edit"]}
        docsHref={`/docs/${p.id}`}
      />

    </div>
  );
}
