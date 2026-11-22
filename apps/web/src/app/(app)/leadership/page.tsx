import { reqCodeOf } from "@pm-collab/core/shared/codes";
import { loadLeadershipData } from "@pm-collab/core/workbench/leadership-query";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { format, startOfMonth, startOfWeek, subMonths, subWeeks } from "date-fns";
import { AlertTriangle, CalendarDays, Rocket, TrendingDown, TrendingUp } from "lucide-react";
import { fmtAgo, fmtMonthDay } from "@/lib/utils";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { HeadPopover } from "@/components/views/HeadControls";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Avatar } from "@/components/ui/Avatar";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
import { bugCode } from "@/components/ui/StatusBadge";

const RANGES = { week: "本周", month: "本月" } as const;
type Range = keyof typeof RANGES;

/** 进展总览（Figma 11）：KPI → 项目进展表 → 需要关注 + 近期发版 */
export default async function LeadershipPage(props: { searchParams: Promise<{ range?: string; project?: string }> }) {
  const searchParams = await props.searchParams;
  const range: Range = searchParams.range === "month" ? "month" : "week";
  const now = new Date();
  const from = range === "week" ? startOfWeek(now, { weekStartsOn: 1 }) : startOfMonth(now);
  const prevFrom = range === "week" ? subWeeks(from, 1) : subMonths(from, 1);
  const monthFrom = startOfMonth(now);
  const prevMonthFrom = subMonths(monthFrom, 1);

  const session = await getSession();
  const { allProjects, projectId, projects, onlineNow, onlinePrev, activeReqs, openBugs, newBugs, relNow, relPrev, overdue, blockers, unassigned, upcoming } = await loadLeadershipData(session, searchParams.project, { now, from, prevFrom, monthFrom, prevMonthFrom });

  // 项目进展：上线进度、进行/总、未关闭 Bug、下个版本、状态
  const rows = projects.map((p) => {
    const effective = p.requirements.filter((r) => r.status !== "cancelled");
    const done = effective.filter((r) => r.status === "online").length;
    const doing = effective.filter((r) => r.status !== "online" && r.status !== "req_in_progress" && r.status !== "req_done").length;
    const pct = effective.length ? Math.round((done / effective.length) * 100) : 0;
    const next = p.releases.find((r) => r.plannedAt) || p.releases[0] || null;
    const late = Boolean(p.plannedEndAt && p.plannedEndAt < now && !p.actualEndAt);
    // 下个版本的进度落后于时间进度 20% 以上 → 风险
    let behind = false;
    if (next?.plannedAt) {
      const span = next.plannedAt.getTime() - next.createdAt.getTime();
      const elapsed = span > 0 ? Math.min(1, Math.max(0, (now.getTime() - next.createdAt.getTime()) / span)) : 1;
      const items = next.items.filter((i) => i.requirement.status !== "cancelled");
      const relPct = items.length ? items.filter((i) => i.requirement.status === "online").length / items.length : 0;
      behind = elapsed - relPct > 0.3;
    }
    const owner = p.members[0]?.user || p.createdBy;
    const status = p.status === "completed" ? "done" : late ? "late" : behind || p.bugs.some((b) => b.severity === "blocker") ? "risk" : "ok";
    return { p, owner, done, doing, total: effective.length, pct, bugs: p.bugs.length, hotBugs: p.bugs.some((b) => b.severity === "blocker" || b.severity === "critical"), next, status, behind };
  });
  const STATUS_TAG = {
    ok: { label: "正常", cls: "is-success" },
    risk: { label: "风险", cls: "is-warning" },
    late: { label: "延期", cls: "is-danger" },
    done: { label: "已完成", cls: "is-neutral" },
  } as const;

  // 需要关注
  const attention = [
    ...overdue.map((r) => ({
      key: `r-${r.id}`,
      href: `/requirements/${r.id}`,
      title: `${reqCodeOf(r)} ${r.title}`,
      sub: `计划 ${fmtMonthDay(r.plannedEndAt)} · 已逾期 ${Math.max(1, Math.floor((now.getTime() - r.plannedEndAt!.getTime()) / 86400000))} 天`,
      tag: "逾期",
      tone: "danger",
    })),
    ...blockers.map((b) => ({
      key: `b-${b.id}`,
      href: `/bugs?bug=${b.id}`,
      title: `${bugCode(b.id)} ${b.title}`,
      sub: `阻塞 · ${b.project?.name || "未归属项目"}`,
      tag: "阻塞",
      tone: "danger",
    })),
    ...unassigned
      .filter((b) => !blockers.some((x) => x.id === b.id))
      .map((b) => ({ key: `u-${b.id}`, href: `/bugs?bug=${b.id}`, title: `${bugCode(b.id)} ${b.title}`, sub: `已提交 ${fmtAgo(b.createdAt)}`, tag: "无负责人", tone: "warning" })),
    ...rows
      .filter((r) => r.behind && r.next)
      .map((r) => ({
        key: `p-${r.p.id}`,
        href: `/releases/${r.next!.id}`,
        title: `${r.p.name} v${r.next!.version}`,
        sub: `项目进度 ${r.pct}%，版本计划 ${fmtMonthDay(r.next!.plannedAt)}`,
        tag: "进度落后",
        tone: "warning",
      })),
  ].slice(0, 6);

  const pctDelta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
  const unit = range === "week" ? "上周" : "上月";
  const kpis = [
    { label: `${RANGES[range]}已上线需求`, value: onlineNow, delta: pctDelta(onlineNow, onlinePrev), note: `较${unit}`, href: "/requirements?stage=online" },
    { label: "进行中需求", value: activeReqs, note: "开发与测试阶段", href: "/requirements?stage=dev" },
    { label: "未关闭 Bug", value: openBugs, note: `${RANGES[range]}新增 ${newBugs}`, href: "/bugs?stage=open", warn: openBugs > 0 },
    { label: "本月发版", value: relNow, delta: pctDelta(relNow, relPrev), note: "较上月", href: "/releases" },
  ];

  const qs = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { range: range === "month" ? "month" : undefined, project: projectId || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/leadership?${s}` : "/leadership";
  };
  const projectName = allProjects.find((p) => p.id === projectId)?.name;
  const relTone = (s: string) => (s === "releasing" ? "is-info" : s === "frozen" ? "is-warning" : s === "released" ? "is-success" : "is-muted");

  return (
    <div className="nv-page-flush">
      <WorkHeader
        crumbs={[{ label: "进展总览", icon: "chart" }]}
        actions={
          <>
            <HeadPopover label={RANGES[range]} icon="display" caret={false} width={160} glyph={<CalendarDays size={14} aria-hidden="true" />}>
              <div className="nv-pop-menu">
                {(Object.keys(RANGES) as Range[]).map((k) => (
                  <Link key={k} href={qs({ range: k === "month" ? "month" : undefined })} aria-current={k === range ? "true" : undefined}>
                    {RANGES[k]}
                  </Link>
                ))}
              </div>
            </HeadPopover>
            <HeadPopover label={projectName || "全部项目"} icon="filter" caret={false} active={Boolean(projectId)} width={220}>
              <div className="nv-pop-menu">
                <Link href={qs({ project: undefined })} aria-current={!projectId ? "true" : undefined}>
                  全部项目
                </Link>
                {allProjects.map((p) => (
                  <Link key={p.id} href={qs({ project: p.id })} aria-current={p.id === projectId ? "true" : undefined}>
                    <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                    {p.name}
                  </Link>
                ))}
              </div>
            </HeadPopover>
          </>
        }
      />
      <div className="nv-page-body">
        <div className="nv-leader">
          <header className="nv-leader-head">
            <h1>进展总览</h1>
            <p>面向技术负责人与项目经理：跨项目看交付节奏、风险与质量。数据截至 {format(now, "M月d日 HH:mm")}。</p>
          </header>

          <section className="nv-leader-kpis" aria-label="总体指标">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href} className="kpi-card">
                <span className="kpi-label">{k.label}</span>
                <span className="kpi-value">{k.value}</span>
                <span className={`kpi-note${k.delta == null ? "" : k.delta > 0 ? " is-up" : k.delta < 0 ? " is-down" : ""}`}>
                  {k.delta == null ? (
                    k.note
                  ) : k.delta === 0 ? (
                    `与${k.note.replace("较", "")}持平`
                  ) : (
                    <>
                      {k.delta > 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
                      {k.delta > 0 ? "+" : ""}
                      {k.delta}% {k.note}
                    </>
                  )}
                </span>
              </Link>
            ))}
          </section>

          <section className="nv-leader-section" aria-labelledby="lead-projects">
            <div className="nv-leader-section-head">
              <h2 id="lead-projects">
                项目进展<span>{rows.length}</span>
              </h2>
              <ExportCsvButton
                label="导出"
                className="btn-ghost nv-head-btn"
                filename={`进展总览-${format(now, "yyyyMMdd")}`}
                head={["项目", "负责人", "上线进度", "进行中需求", "需求总数", "未关闭 Bug", "下个版本", "计划日期", "状态"]}
                rows={rows.map((r) => [
                  r.p.name,
                  r.owner?.name || "",
                  `${r.pct}%`,
                  r.doing,
                  r.total,
                  r.bugs,
                  r.next ? `v${r.next.version}` : "",
                  r.next?.plannedAt ? format(r.next.plannedAt, "yyyy-MM-dd") : "",
                  STATUS_TAG[r.status as keyof typeof STATUS_TAG].label,
                ])}
              />
            </div>
            <div className="nv-leader-table" role="table" aria-label="项目进展">
              <div className="nv-leader-row is-head" role="row">
                <span role="columnheader">项目</span>
                <span role="columnheader">负责人</span>
                <span role="columnheader">上线进度</span>
                <span role="columnheader">需求 进行/总</span>
                <span role="columnheader">未关闭 Bug</span>
                <span role="columnheader">下个版本</span>
                <span role="columnheader">状态</span>
              </div>
              {rows.length === 0 ? <p className="empty-inline nv-leader-empty">暂无项目。</p> : null}
              {rows.map((r) => {
                const tag = STATUS_TAG[r.status as keyof typeof STATUS_TAG];
                return (
                  <div key={r.p.id} className="nv-leader-row" role="row">
                    <span role="cell" className="nv-leader-project">
                      <ProjectIcon name={r.p.name} src={r.p.iconUrl} size={20} />
                      <Link href={`/projects/${r.p.id}`}>{r.p.name}</Link>
                    </span>
                    <span role="cell" className="nv-leader-owner">
                      {r.owner ? (
                        <>
                          <Avatar name={r.owner.name} src={r.owner.avatarUrl} size={16} />
                          {r.owner.name}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span role="cell" className="nv-leader-progress">
                      <span className="nv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct} aria-label={`${r.p.name} 上线进度`}>
                        <span style={{ width: `${r.pct}%` }} className={r.status === "risk" || r.status === "late" ? "is-warning" : undefined} />
                      </span>
                      <span>{r.pct}%</span>
                    </span>
                    <span role="cell" className="nv-leader-num">
                      {r.doing} / {r.total}
                    </span>
                    <span role="cell" className={`nv-leader-num${r.hotBugs ? " is-warn" : ""}`}>
                      {r.bugs}
                    </span>
                    <span role="cell" className="nv-leader-next">
                      {r.next ? (
                        <Link href={`/releases/${r.next.id}`}>
                          <Rocket size={14} aria-hidden="true" />v{r.next.version}
                          {r.next.plannedAt ? ` · ${fmtMonthDay(r.next.plannedAt)}` : ""}
                        </Link>
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                    </span>
                    <span role="cell">
                      <span className={`nv-tag is-dot ${tag.cls}`}>{tag.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="nv-leader-cols">
            <section className="nv-leader-section" aria-labelledby="lead-attn">
              <div className="nv-leader-section-head">
                <h2 id="lead-attn">
                  需要关注<span>{attention.length}</span>
                </h2>
              </div>
              <ul className="nv-leader-box">
                {attention.length === 0 ? <li className="nv-leader-empty">目前没有逾期、阻塞或无人负责的事项。</li> : null}
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href} className="nv-attn">
                      <AlertTriangle size={16} aria-hidden="true" className={`is-${a.tone}`} />
                      <span className="nv-attn-main">
                        <span>{a.title}</span>
                        <small>{a.sub}</small>
                      </span>
                      <span className={`nv-attn-tag is-${a.tone}`}>{a.tag}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="nv-leader-section" aria-labelledby="lead-rel">
              <div className="nv-leader-section-head">
                <h2 id="lead-rel">近期发版</h2>
              </div>
              <ul className="nv-leader-box nv-leader-rel">
                {upcoming.length === 0 ? <li className="nv-leader-empty">近期没有发版计划。</li> : null}
                {upcoming.map((r) => (
                  <li key={r.id}>
                    <Link href={`/releases/${r.id}`}>
                      <span className="nv-rel-date">{fmtMonthDay(r.releasedAt || r.plannedAt) || "未定"}</span>
                      <i className={`nv-rel-dot ${relTone(r.status)}`} aria-hidden="true" />
                      <span className="nv-attn-main">
                        <span>
                          v{r.version}
                          {r.title ? ` · ${r.title}` : ""}
                        </span>
                        <small>{r.project.name}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
