import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requireProjectPage } from "@/lib/page-guard";
import { prisma } from "@/lib/prisma";
import { PageContext } from "@/components/layout/PageContext";
import { RouteTabs } from "@/components/ui/RouteTabs";
import { ListFilters } from "@/components/ui/ListFilters";
import { projectTestLibrary, projectTestRuns, type CaseResult } from "@pm-collab/core/delivery/project-tests";
import { canEditDocs } from "@pm-collab/core/docs/docs-query";
import { getAccess, requirementWhere } from "@/lib/access";
import { NewCasesPageButton } from "@/components/projects/NewCasesPageButton";

export const dynamic = "force-dynamic";

const RESULT: Record<CaseResult, { label: string; tone: string }> = {
  passed: { label: "通过", tone: " tone-success" },
  failed: { label: "失败", tone: " tone-danger" },
  blocked: { label: "阻塞", tone: " tone-warn" },
  skipped: { label: "跳过", tone: "" },
  pending: { label: "待填", tone: "" },
  none: { label: "未执行", tone: "" },
};

/** 项目 · 测试（T42，Figma 88D 用例库 / 88E 测试记录） */
export default async function ProjectTestsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const session = await requireProjectPage(id);
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
  if (!project) notFound();
  const tab = sp.tab === "runs" ? "runs" : "cases";
  const base = `/projects/${id}/tests`;
  const canEdit = await canEditDocs(session, id);
  const reqs = canEdit
    ? await prisma.requirement.findMany({ where: { projectId: id, deletedAt: null, archivedAt: null, status: { not: "cancelled" }, AND: [requirementWhere(await getAccess(session))] }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 200 })
    : [];
  const tabs = [
    { key: "cases", label: "用例库", href: base },
    { key: "runs", label: "测试记录", href: `${base}?tab=runs` },
  ];

  return (
    <div className="page-overview is-wider">
      <PageContext scope="project" projectId={id} crumbs={[{ label: "项目", href: "/projects" }, { label: project.name, href: `/projects/${id}` }, { label: "测试" }]} />
      <header className="nv-overview-head">
        <div className="min-w-0">
          <h1 className="page-title">测试</h1>
          <p className="page-summary">汇总本项目文档空间里所有用例页的用例和每一轮测试。用例在所在用例页里编辑，测试报告会自动挂到相关需求的「资料」里。</p>
        </div>
        {canEdit && tab === "cases" ? (
          <div>
            <NewCasesPageButton projectId={id} reqs={reqs.map((r) => ({ id: r.id, label: r.title }))} />
          </div>
        ) : null}
      </header>
      <RouteTabs tabs={tabs} current={tab} label="测试视图" />
      {tab === "cases" ? <CasesView session={session} projectId={id} sp={sp} /> : <RunsView session={session} projectId={id} sp={sp} />}
    </div>
  );
}

async function CasesView({ session, projectId, sp }: { session: Awaited<ReturnType<typeof requireProjectPage>>; projectId: string; sp: Record<string, string | undefined> }) {
  const lib = await projectTestLibrary(session, projectId);
  if (!lib) notFound();
  const all = lib.groups.flatMap((g) => g.cases);
  const q = (sp.q || "").trim();
  const match = (c: (typeof all)[number]) =>
    (!q || c.title.includes(q) || c.code.toLowerCase().includes(q.toLowerCase())) &&
    (!sp.req || (sp.req === "none" ? !c.req : c.req?.id === sp.req)) &&
    (!sp.priority || c.priority === sp.priority) &&
    (!sp.mode || c.mode === sp.mode) &&
    (!sp.result || c.last === sp.result);
  const reqOptions = [...new Map(all.filter((c) => c.req).map((c) => [c.req!.id, c.req!])).values()];
  const ran = all.filter((c) => c.last !== "none" && c.last !== "pending");
  const kpis = [
    { label: "用例", value: String(all.length), note: `自动 ${all.filter((c) => c.mode === "auto").length} · 手工 ${all.filter((c) => c.mode === "manual").length}` },
    { label: "已关联需求", value: String(reqOptions.length), note: `未关联的用例 ${all.filter((c) => !c.req).length} 条` },
    { label: "最近结果通过率", value: ran.length ? `${Math.round((ran.filter((c) => c.last === "passed").length / ran.length) * 100)}%` : "—", note: `按每条用例最近一次结果` },
    { label: "从未执行", value: String(all.filter((c) => c.last === "none").length), note: `失败待回归 ${all.filter((c) => c.last === "failed").length} 条` },
  ];
  const hasFilters = !!(q || sp.req || sp.priority || sp.mode || sp.result);
  return (
    <>
      <section className="kpi-grid nv-kpis-project" aria-label="用例指标">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card">
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value kpi-plain">{k.value}</span>
            <span className="kpi-note">{k.note}</span>
          </div>
        ))}
      </section>
      <section className="page-section">
        <ListFilters
          ariaLabel="筛选用例"
          search={{ name: "q", value: q, placeholder: "搜索用例标题、编号" }}
          hidden={{ tab: "cases" }}
          hasFilters={hasFilters}
          clearHref={`/projects/${projectId}/tests`}
          selects={[
            { name: "req", label: "关联需求", value: sp.req || "", allLabel: "全部需求", options: [...reqOptions.map((r) => ({ value: r.id, label: `${r.code} ${r.title}` })), { value: "none", label: "未关联需求" }] },
            { name: "priority", label: "优先级", value: sp.priority || "", allLabel: "全部优先级", options: ["P0", "P1", "P2", "P3"].map((p) => ({ value: p, label: p })) },
            { name: "mode", label: "执行方式", value: sp.mode || "", allLabel: "自动和手工", options: [{ value: "auto", label: "自动" }, { value: "manual", label: "手工" }] },
            { name: "result", label: "最近结果", value: sp.result || "", allLabel: "全部结果", options: (Object.keys(RESULT) as CaseResult[]).map((k) => ({ value: k, label: RESULT[k].label })) },
          ]}
        />
        {lib.groups.length ? (
          <div className="card overflow-x-auto nv-tests-table">
            <table className="table-compact w-full min-w-[880px]">
              <thead>
                <tr>
                  <th className="w-[96px]">编号</th>
                  <th>用例标题</th>
                  <th className="w-[240px]">关联需求</th>
                  <th className="w-[90px]">功能点</th>
                  <th className="w-[64px]">优先级</th>
                  <th className="w-[64px]">方式</th>
                  <th className="w-[80px]">最近结果</th>
                </tr>
              </thead>
              {lib.groups.map((g) => {
                const rows = g.cases.filter(match);
                if (hasFilters && !rows.length) return null;
                return (
                  <tbody key={g.pageId}>
                    <tr className="nv-tests-group">
                      <td colSpan={7}>
                        <Link className="text-link" href={g.href}>
                          {g.title}
                        </Link>
                        <span className="nv-tests-count">{g.cases.length}</span>
                        <span className="nv-flow-meta">{g.meta}</span>
                      </td>
                    </tr>
                    {rows.map((c) => (
                      <tr key={c.code}>
                        <td className="nv-mono">{c.code}</td>
                        <td className="cell-title" title={c.title}>
                          <Link href={g.href}>{c.title}</Link>
                        </td>
                        <td className="cell-title">
                          {c.req ? (
                            <Link className="text-link" href={`/requirements/${c.req.id}`} title={c.req.title}>
                              {c.req.code} {c.req.title}
                            </Link>
                          ) : (
                            <span className="nv-flow-meta">未关联</span>
                          )}
                        </td>
                        <td>{c.feature || "—"}</td>
                        <td>{c.priority}</td>
                        <td>{c.mode === "auto" ? "自动" : "手工"}</td>
                        <td>
                          <span className={`nv-dl-tag${RESULT[c.last].tone}`}>{RESULT[c.last].label}</span>
                        </td>
                      </tr>
                    ))}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={7} className="nv-flow-meta">
                          这个用例页还没有用例
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                );
              })}
            </table>
          </div>
        ) : (
          <div className="nv-ra-empty">还没有用例页。在需求文档里用「需求交付」生成测试用例，或在文档空间新建「测试用例」页面后，会自动汇总到这里。</div>
        )}
      </section>
    </>
  );
}

async function RunsView({ session, projectId, sp }: { session: Awaited<ReturnType<typeof requireProjectPage>>; projectId: string; sp: Record<string, string | undefined> }) {
  const releases = await prisma.release.findMany({ where: { projectId, status: { not: "cancelled" } }, select: { id: true, version: true }, orderBy: { createdAt: "desc" }, take: 50 });
  const releaseId = releases.some((r) => r.id === sp.release) ? sp.release : undefined;
  const data = await projectTestRuns(session, projectId, { releaseId });
  if (!data) notFound();
  const rows = data.rows.filter((r) => (!sp.exec || r.executor === sp.exec) && (!sp.result || (sp.result === "failed" ? r.failed > 0 : sp.result === "passed" ? r.total > 0 && r.passed === r.total : true)));
  return (
    <section className="page-section">
      <ListFilters
        ariaLabel="筛选测试记录"
        hidden={{ tab: "runs" }}
        hasFilters={!!(releaseId || sp.exec || sp.result)}
        clearHref={`/projects/${projectId}/tests?tab=runs`}
        selects={[
          { name: "release", label: "发版", value: releaseId || "", allLabel: "全部发版", options: releases.map((r) => ({ value: r.id, label: r.version })) },
          { name: "exec", label: "执行方式", value: sp.exec || "", allLabel: "全部执行方式", options: ["服务器", "本机 Agent", "手工"].map((x) => ({ value: x, label: x })) },
          { name: "result", label: "结果", value: sp.result || "", allLabel: "全部结果", options: [{ value: "passed", label: "全部通过" }, { value: "failed", label: "有失败" }] },
        ]}
      />
      {rows.length ? (
        <div className="card overflow-x-auto nv-tests-table">
          <table className="table-compact w-full min-w-[960px]">
            <thead>
              <tr>
                <th className="w-[80px]">轮次</th>
                <th>用例页 / 需求</th>
                <th className="w-[100px]">执行</th>
                <th className="w-[150px]">环境</th>
                <th className="w-[200px]">结果</th>
                <th className="w-[80px]">发起人</th>
                <th className="w-[110px]">时间</th>
                <th className="w-[80px]">报告</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="cell-title">
                    {r.pageHref ? <Link href={r.pageHref}>{r.pageTitle}</Link> : r.pageTitle}
                    {r.reqs ? <span className="nv-flow-meta"> {r.reqs}</span> : null}
                  </td>
                  <td>{r.executor}</td>
                  <td className="cell-title" title={r.env}>
                    {r.env}
                  </td>
                  <td>
                    <span className="nv-tests-bar" aria-hidden="true">
                      {r.total ? (
                        <>
                          <i className="is-ok" style={{ width: `${(r.passed / r.total) * 100}%` }} />
                          <i className="is-bad" style={{ width: `${(r.failed / r.total) * 100}%` }} />
                          <i className="is-warn" style={{ width: `${(r.blocked / r.total) * 100}%` }} />
                        </>
                      ) : null}
                    </span>
                    <span className={r.failed ? "nv-tests-bad" : "nv-tests-ok"}>
                      {r.passed} / {r.total} 通过{r.failed ? ` · ${r.failed} 失败` : ""}
                      {r.blocked ? ` · ${r.blocked} 阻塞` : ""}
                    </span>
                    {r.status !== "已完成" ? <span className="nv-flow-meta"> · {r.status}</span> : null}
                  </td>
                  <td>{r.by}</td>
                  <td>{format(r.at, "MM-dd HH:mm")}</td>
                  <td>
                    {r.reportHref ? (
                      <Link className="text-link" href={r.reportHref}>
                        查看报告
                      </Link>
                    ) : (
                      <span className="nv-flow-meta">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="nv-ra-empty">还没有测试记录。在需求交付的「测试」阶段发起一轮测试后，会出现在这里。</div>
      )}
      <p className="nv-ra-note">每轮「完成本轮」后，结果会挂到相关需求的「资料 · 测试报告」；试跑不算正式报告。</p>
    </section>
  );
}
