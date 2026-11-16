import { requireProjectPage } from "@/lib/page-guard";
import { notFound } from "next/navigation";
import { findProjectForPlans } from "@pm-collab/core/projects/layout-query";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageContext } from "@/components/layout/PageContext";
import { PlanCards } from "@/components/plans/PlanList";
import { NewReleaseButton } from "@/components/releases/ReleaseForm";
import { loadReleasePlans, planDates, planTone } from "@/lib/release-plans";

/** 项目 · 上线计划（Figma 35）：按上线计划查看实际完成的需求 */
export default async function ProjectPlansPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireProjectPage(params.id);
  const project = await findProjectForPlans(params.id);
  if (!project) notFound();
  const session = await getSession();
  const [plans, canManage] = await Promise.all([loadReleasePlans(project.id), session ? can(session, "releases.manage", project.id) : false]);

  const count = { released: 0, active: 0, planning: 0 };
  for (const p of plans) {
    const t = planTone(p).label;
    if (t === "已上线") count.released++;
    else if (t === "规划中") count.planning++;
    else count.active++;
  }
  const total = plans.reduce((n, p) => n + p.total, 0);
  const done = plans.reduce((n, p) => n + p.done, 0);
  const next = plans.find((p) => p.status !== "released" && p.plannedAt);
  const kpis = [
    { label: "上线计划", value: String(plans.length), note: `已上线 ${count.released} · 进行中 ${count.active} · 规划中 ${count.planning}` },
    { label: "计划需求", value: String(total), note: `已完成 ${done}` },
    { label: "整体完成率", value: `${total ? Math.round((done / total) * 100) : 0}%`, note: "按计划内需求统计" },
    {
      label: "下一次上线",
      value: next?.plannedAt ? `${new Date(next.plannedAt).getMonth() + 1}月${new Date(next.plannedAt).getDate()}日` : "—",
      note: next ? `${next.version} · ${planDates(next).split(" · ")[1] || ""}` : "暂无待上线计划",
    },
  ];

  return (
    <div className="page-overview is-wide nv-project-overview">
      <PageContext scope="project" projectId={project.id} crumbs={[{ label: "项目", href: "/projects" }, { label: project.name, href: `/projects/${project.id}` }, { label: "上线计划" }]} />
      <header className="nv-overview-head">
        <div className="min-w-0">
          <h1 className="page-title">上线计划</h1>
          <p className="page-summary">按上线计划查看实际完成的需求：一个项目可以有多个上线计划，需求加入计划后随状态自动统计。</p>
        </div>
        {canManage ? (
          <div>
            <NewReleaseButton defaultProjectId={project.id} className="btn-primary nv-head-btn" label="新建上线计划" />
          </div>
        ) : null}
      </header>
      <section className="kpi-grid nv-kpis-project" aria-label="上线计划指标">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card">
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value kpi-plain">{k.value}</span>
            <span className="kpi-note">{k.note}</span>
          </div>
        ))}
      </section>
      <section className="page-section" aria-label="上线计划列表">
        {plans.length ? (
          <PlanCards plans={plans} />
        ) : (
          <div className="empty-state">
            <p className="empty-title">还没有上线计划</p>
            <p>在「发版」里新建一个版本，把需求加进去，这里就会按计划统计实际完成情况。</p>
          </div>
        )}
      </section>
    </div>
  );
}
