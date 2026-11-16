import Link from "next/link";
import { Info } from "lucide-react";
import type { ProjectBoardRow } from "@pm-collab/core/requirements/board-summary-query";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ProjectIcon } from "@/components/projects/ProjectIcon";

const STAGES = [
  { key: "req", label: "需求阶段" },
  { key: "dev", label: "开发阶段" },
  { key: "test", label: "测试阶段" },
  { key: "online", label: "已上线" },
] as const;

/**
 * 全局看板（按项目汇总）：每个进行中项目一行，需求按阶段计数、进度、未关闭 Bug、逾期需求。
 * 看明细点项目进入「项目看板」。
 */
export function ProjectsSummaryBoard({ rows }: { rows: ProjectBoardRow[] }) {
  const sum = (f: (r: ProjectBoardRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const kpis = [
    { label: "进行中项目", value: rows.length },
    { label: "需求总数", value: sum((r) => r.total) },
    { label: "已上线", value: sum((r) => r.stages.online) },
    { label: "未关闭 Bug", value: sum((r) => r.openBugs) },
    { label: "逾期需求", value: sum((r) => r.overdue), warn: true },
  ];
  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader crumbs={[{ label: "看板", icon: "columns" }]} count={rows.length} />
      </div>
      <p className="nv-pos-note" role="note">
        <Info size={14} aria-hidden="true" />
        全局看板按项目汇总需求和 Bug 的数量；点项目名进入「项目看板」查看和拖动明细。只统计你能看到的数据。
      </p>
      <div className="list-table-scroll nv-list-scroll">
        <div className="nv-psum-kpis" role="list" aria-label="汇总">
          {kpis.map((k) => (
            <div key={k.label} className="nv-psum-kpi" role="listitem">
              <span>{k.label}</span>
              <b className={k.warn && k.value ? "is-warning" : undefined}>{k.value}</b>
            </div>
          ))}
        </div>
        <div className="nv-pos-table" role="table" aria-label={`项目汇总，共 ${rows.length} 个`}>
          <div className="nv-pos-row nv-psum-row is-head" role="row">
            <span role="columnheader">项目</span>
            {STAGES.map((s) => (
              <span key={s.key} role="columnheader">{s.label}</span>
            ))}
            <span role="columnheader">进度</span>
            <span role="columnheader">未关闭 Bug</span>
            <span role="columnheader">逾期</span>
          </div>
          {rows.length === 0 ? <div className="nv-nova-empty">还没有进行中的项目。</div> : null}
          {rows.map((r) => {
            const pct = r.total ? Math.round((r.stages.online / r.total) * 100) : 0;
            return (
              <div key={r.id} className="nv-pos-row nv-psum-row" role="row">
                <span role="cell" className="nv-pos-name">
                  <ProjectIcon name={r.name} src={r.iconUrl} size={20} />
                  <Link href={`/projects/${r.id}/board`} className="nv-psum-link">
                    {r.name}
                  </Link>
                  <code>{r.key}</code>
                </span>
                {STAGES.map((s) => (
                  <span key={s.key} role="cell">{r.stages[s.key]}</span>
                ))}
                <span role="cell" className="nv-psum-progress">
                  <span className="nv-progress" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span>{pct}%</span>
                </span>
                <span role="cell">{r.openBugs}</span>
                <span role="cell">{r.overdue ? <span className="nv-tag is-warning">{r.overdue}</span> : 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
