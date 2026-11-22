import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, ChartColumn } from "lucide-react";
import { findReleaseForPage, canViewReleasePage, loadReleasePageDetails } from "@pm-collab/core/releases/detail-page-query";
import { getSession } from "@/lib/auth";
import { ReleaseStatusBadge } from "@/components/ui/StatusBadge";
import { ReleaseActions } from "@/components/releases/ReleaseActions";
import { EditReleaseButton } from "@/components/releases/ReleaseForm";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
import { Burndown } from "@/components/releases/Burndown";
import { RequirementPoolTable } from "@/components/requirements/RequirementPoolTable";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { Banner } from "@/components/ui/Banner";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Avatar } from "@/components/ui/Avatar";
import { toPoolRows } from "@/lib/requirements-pool";
import { PRIORITY_LABELS, REQ_STATUS, isReqDone } from "@/lib/constants";
import { fmtMonthDay } from "@/lib/utils";
import Link from "next/link";
import { EditHotfixButton } from "@/components/releases/HotfixReleaseButton";
import { ReleaseKindBadge } from "@/components/releases/ReleaseKindBadge";
import { BugStatusBadge } from "@/components/ui/StatusBadge";
import { artifactCompleteness } from "@pm-collab/core/requirements/artifacts";
import { ReleaseCodeCompare } from "@/components/git/ReleaseCodeCompare";
import { reqStatusLabel } from "@/lib/constants";

/** 发版详情（Figma 09）：功能区 → 冻结横幅 → 版本头 → 需求构成 + 燃尽 → 包含的需求 */
export default async function ReleaseDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const release = await findReleaseForPage(params.id);
  if (!release) notFound();
  const session = await getSession();
  if (!session || !(await canViewReleasePage(session, release.projectId))) notFound();
  const { perms, bugs } = await loadReleasePageDetails(session, release);
  const isHotfix = release.kind === "hotfix";
  const pendingBugs = bugs.filter((b) => ["open", "in_progress", "reopened"].includes(b.status)).length;

  const reqs = release.items.map((i) => i.requirement);
  const live = reqs.filter((r) => r.status !== "cancelled");
  const total = live.length;
  const online = live.filter((r) => isReqDone(r.status)).length;
  const pendingReqs = total - online;
  const pct = total ? Math.round((online / total) * 100) : release.status === "released" ? 100 : 0;
  const editable = release.status !== "released" && release.status !== "cancelled";
  const rows = toPoolRows(reqs);
  // 需求资料齐全度（T42，Figma 88F）
  const art = await artifactCompleteness(live.map((r) => r.id));
  const artRows = live.map((r) => ({ r, c: art[r.id] })).filter((x) => x.c);
  const missing = artRows.filter((x) => !x.c.doc || !x.c.testcases || !x.c.report);
  const noReport = artRows.filter((x) => !x.c.report).length;
  const noCases = artRows.filter((x) => !x.c.testcases).length;
  const noDoc = artRows.filter((x) => !x.c.doc).length;

  // 构成：按状态计数（按流程顺序，只列出有需求的状态）
  const composition = REQ_STATUS.map((s) => ({ ...s, n: reqs.filter((r) => r.status === s.key).length })).filter((s) => s.n);

  // 燃尽：开始 = 创建日，结束 = 上线日 / 计划日（没有则 +14 天）
  const start = release.createdAt;
  const end = release.releasedAt || release.plannedAt || new Date(start.getTime() + 14 * 86400000);
  const doneAt = live.filter((r) => isReqDone(r.status)).map((r) => r.actualEndAt || r.updatedAt);
  const now = new Date();
  const span = Math.max(end.getTime() - start.getTime(), 1);
  const idealRemaining = total * (1 - Math.min(Math.max((now.getTime() - start.getTime()) / span, 0), 1));
  const lead = Math.round(idealRemaining - pendingReqs);
  const leadText = !total ? "还没有需求" : lead > 0 ? `比计划提前 ${lead} 个需求` : lead < 0 ? `比计划落后 ${-lead} 个需求` : "与计划持平";

  const owner = release.creator;
  const dateRange = `${fmtMonthDay(release.createdAt)} → ${release.releasedAt ? fmtMonthDay(release.releasedAt) : release.plannedAt ? fmtMonthDay(release.plannedAt) : "未定"}`;

  return (
    <div className="nv-page-flush nv-release-detail">
      <WorkHeader
        crumbs={[
          { label: "发版", href: "/releases", icon: "rocket" },
          { label: `v${release.version}` },
        ]}
        actions={
          <>
            <ExportCsvButton
              label="导出清单"
              filename={`${release.project.key}-v${release.version}-需求清单`}
              head={["编号", "标题", "状态", "优先级", "负责人", "截止日期"]}
              rows={rows.map((r) => [
                r.code,
                r.title,
                r.status,
                PRIORITY_LABELS[r.priority]?.label || r.priority,
                r.owners.map((o) => o.name).join("、"),
                r.plannedEndAt ? format(new Date(r.plannedEndAt), "yyyy-MM-dd") : "",
              ])}
            />
            {perms["releases.manage"] && editable && isHotfix ? (
              <EditHotfixButton
                releaseId={release.id}
                frozen={release.status === "frozen"}
                values={{
                  projectId: release.projectId,
                  version: release.version,
                  title: release.title || "",
                  reason: release.reason || "",
                  plannedAt: release.plannedAt ? format(release.plannedAt, "yyyy-MM-dd") : "",
                  bugIds: release.bugs.map((b) => b.bugId),
                  requirementIds: release.items.map((i) => i.requirementId),
                }}
              />
            ) : null}
            {perms["releases.manage"] && editable && !isHotfix ? (
              <EditReleaseButton
                className="btn-secondary nv-head-btn"
                releaseId={release.id}
                frozen={release.status === "frozen"}
                values={{
                  projectId: release.projectId,
                  version: release.version,
                  title: release.title || "",
                  plannedAt: release.plannedAt ? format(release.plannedAt, "yyyy-MM-dd") : "",
                  description: release.description || "",
                  requirementIds: release.items.map((i) => i.requirementId),
                }}
              />
            ) : null}
            <ReleaseActions
              compact
              releaseId={release.id}
              status={release.status}
              version={release.version}
              pendingRequirements={pendingReqs}
              totalRequirements={total}
              pendingBugs={pendingBugs}
              canManage={perms["releases.manage"]}
            />
          </>
        }
      />

      {release.status === "frozen" ? (
        <div className="nv-release-banner">
          <Banner title="本版本已冻结">v{release.version} 已进入冻结期，新需求请放入下一个版本。</Banner>
        </div>
      ) : null}

      {isHotfix && release.reason ? (
        <div className="nv-release-banner">
          <Banner tone="warning" title="紧急发版 · 线上问题">
            <span className="whitespace-pre-wrap">{release.reason}</span>
          </Banner>
        </div>
      ) : null}

      <header className="nv-release-head">
        <ProgressRing pct={pct} size={48} />
        <div className="nv-release-head-main">
          <h1>
            v{release.version}
            {release.title ? <> · {release.title}</> : null}
          </h1>
          <p>
            {release.project.name}
            {release.kind === "scheduled" ? " · 按固定发版节奏自动生成" : ""}
            <ReleaseKindBadge kind={release.kind} />
            {owner ? ` · 负责人 ${owner.name}` : ""}
          </p>
        </div>
        <span className="pp">
          <CalendarDays size={14} aria-hidden="true" />
          {dateRange}
        </span>
        <ReleaseStatusBadge status={release.status} />
        {owner ? <Avatar name={owner.name} src={owner.avatarUrl} size={20} /> : null}
      </header>

      <div className="nv-release-panels">
        <section className="nv-release-compose" aria-labelledby="rel-compose">
          <h2 id="rel-compose">本版本需求构成</h2>
          <p className={`nv-release-lead${lead < 0 ? " is-behind" : ""}`}>
            <ChartColumn size={16} aria-hidden="true" />
            {leadText}
          </p>
          <ul>
            {composition.map((s) => (
              <li key={s.key}>
                <i style={{ background: s.color }} aria-hidden="true" />
                <span>{s.label}</span>
                <b>{s.n}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className="nv-release-burn" aria-labelledby="rel-burn">
          <h2 id="rel-burn">
            燃尽<small>剩余需求数</small>
          </h2>
          <Burndown start={start} end={end} total={total} doneAt={doneAt} now={now} />
        </section>
      </div>

      {isHotfix || bugs.length ? (
        <section aria-labelledby="rel-bugs" className="nv-release-items">
          <h2 id="rel-bugs" className="nv-release-items-title">
            修复的 Bug<span className="nv-count">{bugs.length}</span>
          </h2>
          {bugs.length ? (
            <ul className="nv-list" aria-label="修复的 Bug">
              {bugs.map((b) => (
                <li key={b.id} className="nv-row">
                  <span className="nv-release-main">
                    <Link href={`/bugs/${b.id}`} className="nv-row-link">
                      {b.title}
                    </Link>
                  </span>
                  <span className="nv-row-props">
                    {b.environment === "production" ? <span className="badge badge-danger">线上</span> : null}
                    <BugStatusBadge status={b.status} />
                    {b.assignee ? (
                      <span title={`处理人 ${b.assignee.name}`}>
                        <Avatar name={b.assignee.name} src={b.assignee.avatarUrl} size={20} />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-sm text-nv-text-secondary">
              还没有关联 Bug{perms["releases.manage"] && editable ? "，点「编辑」勾选这次要修复的线上问题。" : "。"}
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="rel-items" className="nv-release-items">
        <h2 id="rel-items" className="nv-release-items-title">
          包含的需求<span className="nv-count">{reqs.length}</span>
        </h2>
        <RequirementPoolTable
          rows={rows}
          flat
          showProject={false}
          canMove={perms["board.move"]}
          emptyTitle="还没有关联需求"
          emptyBody={
            perms["releases.manage"] && editable ? "点「编辑 / 选需求」勾选要随本版本上线的需求。" : "这个版本没有关联需求。"
          }
        />
      </section>
      <ReleaseCodeCompare releaseId={release.id} version={release.version} editable={editable} />
      {artRows.length ? (
        <section aria-labelledby="rel-art" className="nv-release-items nv-rel-art">
          <h2 id="rel-art" className="nv-release-items-title">
            需求资料<span className="nv-count">资料齐全 {artRows.length - missing.length} / {artRows.length}</span>
          </h2>
          {missing.length ? (
            <p className="nv-rel-art-warn" role="note">
              {missing.length} 条需求缺资料：{[noDoc ? `${noDoc} 条没有需求文档` : "", noCases ? `${noCases} 条没有测试用例` : "", noReport ? `${noReport} 条没有测试报告` : ""].filter(Boolean).join("，")}。
            </p>
          ) : null}
          <div className="card overflow-x-auto">
            <table className="table-compact w-full min-w-[760px]">
              <thead>
                <tr>
                  <th>需求</th>
                  <th className="w-[96px]">状态</th>
                  <th className="is-c w-[56px]">UI</th>
                  <th className="is-c w-[56px]">原型</th>
                  <th className="is-c w-[56px]">文档</th>
                  <th className="is-c w-[56px]">用例</th>
                  <th className="is-c w-[56px]">报告</th>
                  <th className="w-[150px]">最近一轮测试</th>
                </tr>
              </thead>
              <tbody>
                {artRows.map(({ r, c }) => (
                  <tr key={r.id}>
                    <td className="cell-title" title={r.title}>
                      <Link href={`/requirements/${r.id}#rq-artifacts`}>{r.title}</Link>
                    </td>
                    <td>{reqStatusLabel(r.status)}</td>
                    {(["ui", "prototype"] as const).map((k) => (
                      <td key={k} className={c[k] ? "is-ok" : "is-na"} title={c[k] ? "已有" : "没有（不是每条需求都需要）"}>
                        {c[k] ? "✓" : "—"}
                      </td>
                    ))}
                    {(["doc", "testcases", "report"] as const).map((k) => (
                      <td key={k} className={c[k] ? "is-ok" : "is-missing"}>
                        {c[k] ? "✓" : "缺"}
                      </td>
                    ))}
                    <td className={c.result ? (c.result.failed ? "tone-danger" : "tone-ok") : "nv-flow-meta"}>
                      {c.result ? `第 ${c.result.round} 轮 ${c.result.passed} / ${c.result.total} 通过` : "还没有正式测试"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
