import { reqCodeOf } from "../shared/codes";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { getAccess, requirementWhere } from "../access";
import { canViewSpace } from "../docs/docs-query";
import { parseCasesBody, type TestCase } from "../shared/testcases";

/**
 * 项目 · 测试（T42，Figma 88D / 88E）：用例库 = 本项目文档空间里所有用例页的用例汇总；测试记录 = 所有轮次。
 * 用例仍存在各自的用例页（需求交付生成的 + 手动新建的），这里只读汇总，不另起一套存储。
 */

export type CaseResult = "passed" | "failed" | "blocked" | "skipped" | "pending" | "none";
export type LibraryCase = TestCase & {
  pageId: string;
  req: { id: string; code: string; title: string } | null;
  last: CaseResult;
};
export type LibraryGroup = { pageId: string; title: string; meta: string; href: string; cases: LibraryCase[] };

const code = (r: { number: number }) => (reqCodeOf(r));

async function visibleReqs(session: SessionUser, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; code: string; title: string }>();
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids }, deletedAt: null, AND: [requirementWhere(await getAccess(session))] }, select: { id: true, number: true, title: true, project: { select: { key: true } } } });
  return new Map(rows.map((r) => [r.id, { id: r.id, code: code(r), title: r.title }]));
}

/** 用例库：按用例页分组；看不到项目空间返回 null */
export async function projectTestLibrary(session: SessionUser, projectId: string) {
  if (!(await canViewSpace(session, projectId))) return null;
  const pages = await prisma.docPage.findMany({
    where: { projectId, kind: "testcases", deletedAt: null, archivedAt: null },
    select: { id: true, title: true, body: true, version: true, creator: { select: { name: true } }, primaryOf: { select: { id: true } }, links: { where: { requirementId: { not: null } }, select: { requirementId: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const deliveries = await prisma.delivery.findMany({ where: { casesPageId: { in: pages.map((p) => p.id) } }, select: { id: true, casesPageId: true, sourcePageId: true, casesStatus: true, casesConfirmedVersion: true, prdConfirmedVersion: true, featureReqs: true } });
  const sourceReqs = await prisma.requirement.findMany({ where: { docPageId: { in: deliveries.map((d) => d.sourcePageId) }, deletedAt: null }, select: { id: true, docPageId: true } });
  // 每条用例最近一次结果（正式轮和试跑都算，误报不算）
  const results = await prisma.deliveryResult.findMany({
    where: { voided: false, run: { deliveryId: { in: deliveries.map((d) => d.id) }, status: { in: ["done", "finalized", "manual", "running"] } } },
    select: { code: true, status: true, run: { select: { deliveryId: true, createdAt: true } } },
    orderBy: { run: { createdAt: "desc" } },
    take: 5000,
  });
  const lastOf = new Map<string, CaseResult>();
  for (const r of results) {
    const k = `${r.run.deliveryId}:${r.code}`;
    if (!lastOf.has(k)) lastOf.set(k, r.status as CaseResult);
  }
  const reqIds = new Set<string>();
  const parsed = pages.map((p) => {
    const d = deliveries.find((x) => x.casesPageId === p.id) || null;
    const fr = d?.featureReqs && typeof d.featureReqs === "object" ? (d.featureReqs as Record<string, string>) : {};
    const fallback = (d ? sourceReqs.find((r) => r.docPageId === d.sourcePageId)?.id : null) || p.primaryOf[0]?.id || p.links[0]?.requirementId || null;
    const cases = parseCasesBody(p.body || "").map((c) => {
      const rid = (c.feature && fr[c.feature]) || fallback;
      if (rid) reqIds.add(rid);
      return { c, rid, last: (d ? lastOf.get(`${d.id}:${c.code}`) : undefined) || ("none" as CaseResult) };
    });
    return { p, d, cases };
  });
  const reqs = await visibleReqs(session, [...reqIds]);
  const groups: LibraryGroup[] = parsed.map(({ p, d, cases }) => ({
    pageId: p.id,
    title: p.title,
    href: `/docs/${projectId}/pages/${p.id}`,
    meta: d ? `需求交付 · ${d.casesStatus === "confirmed" ? `已确认 v${d.casesConfirmedVersion ?? p.version}` : "草稿"}${d.prdConfirmedVersion ? ` · 依据 PRD v${d.prdConfirmedVersion}` : ""}` : `手动新建 · ${p.creator.name}`,
    cases: cases.map(({ c, rid, last }) => ({ ...c, pageId: p.id, req: rid ? reqs.get(rid) || null : null, last })),
  }));
  return { groups };
}

export type RunRow = {
  id: string;
  label: string;
  pageTitle: string;
  pageHref: string;
  reqs: string;
  executor: string;
  env: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  status: string;
  by: string;
  at: Date;
  reportHref: string | null;
};

const EXEC: Record<string, string> = { server: "服务器", local: "本机 Agent" };
const RUN_STATUS: Record<string, string> = { queued: "排队中", running: "执行中", stopping: "停止中", manual: "待填手工结果", done: "待完成本轮", finalized: "已完成", stopped: "已停止", failed: "执行出错" };

/** 测试记录：本项目所有轮次（含试跑），可按发版筛选（这一轮关联的需求在发版里） */
export async function projectTestRuns(session: SessionUser, projectId: string, opts: { releaseId?: string } = {}) {
  if (!(await canViewSpace(session, projectId))) return null;
  const deliveries = await prisma.delivery.findMany({ where: { projectId }, select: { id: true, sourcePageId: true, casesPageId: true, featureReqs: true } });
  const pageIds = deliveries.flatMap((d) => [d.sourcePageId, d.casesPageId]).filter((x): x is string => !!x);
  const pages = await prisma.docPage.findMany({ where: { id: { in: pageIds } }, select: { id: true, title: true, deletedAt: true } });
  const srcReqs = await prisma.requirement.findMany({ where: { docPageId: { in: deliveries.map((d) => d.sourcePageId) }, deletedAt: null }, select: { id: true, docPageId: true } });
  const reqIdsOf = (d: (typeof deliveries)[number]) => {
    const fr = d.featureReqs && typeof d.featureReqs === "object" ? Object.values(d.featureReqs as Record<string, string>) : [];
    return [...new Set([...srcReqs.filter((r) => r.docPageId === d.sourcePageId).map((r) => r.id), ...fr])];
  };
  let allowed: Set<string> | null = null;
  if (opts.releaseId) {
    const items = await prisma.releaseRequirement.findMany({ where: { releaseId: opts.releaseId, release: { projectId } }, select: { requirementId: true } });
    const inRelease = new Set(items.map((i) => i.requirementId));
    allowed = new Set(deliveries.filter((d) => reqIdsOf(d).some((id) => inRelease.has(id))).map((d) => d.id));
  }
  const runs = await prisma.deliveryRun.findMany({
    where: { deliveryId: { in: deliveries.filter((d) => !allowed || allowed.has(d.id)).map((d) => d.id) } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { results: { select: { status: true, voided: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const reqs = await visibleReqs(session, [...new Set(deliveries.flatMap(reqIdsOf))]);
  const reportIds = runs.map((r) => r.reportPageId).filter((x): x is string => !!x);
  const reports = new Set((await prisma.docPage.findMany({ where: { id: { in: reportIds }, deletedAt: null }, select: { id: true } })).map((p) => p.id));
  const rows: RunRow[] = runs.map((r) => {
    const d = deliveries.find((x) => x.id === r.deliveryId)!;
    const page = pages.find((p) => p.id === (d.casesPageId || d.sourcePageId));
    const valid = r.results.filter((x) => !x.voided);
    const rq = reqIdsOf(d).map((id) => reqs.get(id)).filter((x): x is { id: string; code: string; title: string } => !!x);
    return {
      id: r.id,
      label: r.kind === "trial" ? "试跑" : `第 ${r.round} 轮`,
      pageTitle: page && !page.deletedAt ? page.title : "（用例页已删除）",
      pageHref: page && !page.deletedAt ? `/docs/${projectId}/pages/${page.id}` : "",
      reqs: rq.length ? (rq.length > 1 ? `${rq[0].code} 等 ${rq.length} 条` : rq[0].code) : "",
      executor: r.scope === "manual" ? "手工" : EXEC[r.executor] || r.executor,
      env: r.envName ? `${r.envName}` : r.envUrl,
      passed: valid.filter((x) => x.status === "passed").length,
      failed: valid.filter((x) => x.status === "failed").length,
      blocked: valid.filter((x) => x.status === "blocked").length,
      total: valid.length,
      status: RUN_STATUS[r.status] || r.status,
      by: users.find((u) => u.id === r.createdById)?.name || "—",
      at: r.createdAt,
      reportHref: r.reportPageId && reports.has(r.reportPageId) ? `/docs/${projectId}/pages/${r.reportPageId}` : null,
    };
  });
  return { rows };
}
