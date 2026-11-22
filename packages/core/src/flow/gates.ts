import { prisma } from "@pm-collab/db/prisma";
import { GATE_DEFS, type GateKey } from "../shared/flow-config-shared";

/**
 * T43 关卡检查：返回这一段缺的项（中文），全满足返回 []。
 * 数据来源：需求交付（PRD / 用例确认、正式测试轮次）、需求资料（T42）、任务（T43）、Bug。
 * 「代码已合并」要等三期接入 GitLab：项目没有绑定代码仓库时不拦。
 */

export const GATE_STAGE_LABEL: Record<string, string> = { design: "进入设计", dev: "进入开发", test: "进入测试", online: "上线" };
const DEV_KINDS = ["frontend", "backend", "dev"];
const OPEN_BUGS = ["open", "in_progress", "reopened"];

type Req = { id: string; projectId: string | null; docPageId: string | null };

async function context(r: Req) {
  const row = await prisma.requirement.findUnique({ where: { id: r.id }, select: { parentId: true, parent: { select: { docPageId: true } } } });
  const docs = [r.docPageId, row?.parent?.docPageId].filter((x): x is string => !!x);
  const deliveries = docs.length ? await prisma.delivery.findMany({ where: { sourcePageId: { in: docs } }, select: { id: true, prdStatus: true, casesStatus: true } }) : [];
  return { parentId: row?.parentId ?? null, deliveries };
}

const artifactKinds = async (id: string, parentId: string | null) =>
  new Set((await prisma.requirementArtifact.findMany({ where: { OR: [{ requirementId: id }, ...(parentId ? [{ requirementId: parentId, shareToChildren: true }] : [])] }, select: { kind: true } })).map((a) => a.kind));

/** 一组任务是否全部完成（至少要有一条；取消的不算） */
async function tasksDone(id: string, kinds: string[]) {
  const ts = await prisma.requirementTask.findMany({ where: { requirementId: id, kind: { in: kinds }, status: { not: "cancelled" } }, select: { status: true } });
  return ts.length > 0 && ts.every((t) => t.status === "done");
}

async function lastRound(deliveryIds: string[]) {
  if (!deliveryIds.length) return null;
  return prisma.deliveryRun.findFirst({ where: { deliveryId: { in: deliveryIds }, kind: "round", status: "finalized" }, orderBy: { finalizedAt: "desc" }, include: { results: { select: { status: true, voided: true } } } });
}

/** T44：项目绑定了代码仓库时，要求需求或它的任务有已合并的 MR；没绑仓库不拦 */
async function mergedOk(r: Req) {
  if (!r.projectId) return true;
  const { codeMergedFor } = await import("../git/service");
  return (await codeMergedFor(r.id, r.projectId)) !== false;
}

export async function missingGates(r: Req, stage: string, gates: readonly GateKey[]): Promise<string[]> {
  const wanted = GATE_DEFS.filter((g) => g.stage === stage && gates.includes(g.key));
  if (!wanted.length) return [];
  const ctx = await context(r);
  const miss: string[] = [];
  let kinds: Set<string> | null = null;
  const getKinds = async () => (kinds ??= await artifactKinds(r.id, ctx.parentId));
  for (const g of wanted) {
    let ok = true;
    switch (g.key) {
      case "design:prd":
      case "dev:prd":
        ok = ctx.deliveries.some((d) => d.prdStatus === "confirmed");
        break;
      case "dev:ui":
        ok = (await getKinds()).has("ui");
        break;
      case "dev:prototype":
        ok = (await getKinds()).has("prototype");
        break;
      case "dev:designTasks":
        ok = await tasksDone(r.id, ["design"]);
        break;
      case "test:devTasks":
        ok = await tasksDone(r.id, DEV_KINDS);
        break;
      case "test:merged":
        ok = await mergedOk(r);
        break;
      case "test:cases":
        ok = ctx.deliveries.some((d) => d.casesStatus === "confirmed") || (await getKinds()).has("testcases");
        break;
      case "online:testPassed": {
        const run = await lastRound(ctx.deliveries.map((d) => d.id));
        ok = !!run && run.results.filter((x) => !x.voided).every((x) => x.status === "passed");
        break;
      }
      case "online:report":
        ok = (await getKinds()).has("report") || !!(await lastRound(ctx.deliveries.map((d) => d.id)));
        break;
      case "online:noBlockers": {
        const kids = (await prisma.requirement.findMany({ where: { parentId: r.id, deletedAt: null }, select: { id: true } })).map((k) => k.id);
        ok = (await prisma.bug.count({ where: { requirementId: { in: [r.id, ...kids] }, status: { in: OPEN_BUGS }, severity: { in: ["blocker", "critical"] }, deletedAt: null } })) === 0;
        break;
      }
    }
    if (!ok) miss.push(g.label.replace(/（.*）$/, ""));
  }
  return miss;
}
