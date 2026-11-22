import { cache } from "react";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { can } from "../permissions";
import { canSeeProject, getAccess, projectWhere } from "../access";
import { REQ_STATUS } from "../shared/constants";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { enterpriseAdminOf } from "../shared/enterprise-admin";
import { enterpriseOfUserId } from "../shared/role-ceiling";
import { listOrgs, subtreeIds } from "../shared/org";
import { getHiddenStatuses } from "../shared/req-stages";
import { LOCKED_REQ_STATUSES, parseHiddenStatuses, remapHiddenStatus } from "../shared/req-stages-shared";
import {
  REVIEW_GATE_MESSAGE,
  crossesReviewGate,
  gateStageFor,
  isFlowMode,
  parseGates,
  parseIdList,
  type GateKey,
  enterpriseFlowFromRow,
  flowStatusLabel,
  labelConflict,
  parseLabels,
  projectFlowFromRow,
  resolveFlow,
  type EffectiveFlow,
  type EnterpriseFlow,
} from "../shared/flow-config-shared";

/**
 * T41 研发流程配置：企业默认（企业超管 / 系统超管改）+ 项目覆盖（有「编辑项目」权限的人改，企业允许时）。
 * 多租户：企业超管只能看 / 改本企业，别的企业一律按不存在；项目要看得到才能读写它的流程。
 */

const ALL = REQ_STATUS.map((s) => s.key as string);

export const getEnterpriseFlow = cache(async (enterpriseId: string | null | undefined): Promise<EnterpriseFlow | null> => {
  if (!enterpriseId) return null;
  const row = await prisma.flowConfig.findUnique({ where: { scope_scopeId: { scope: "enterprise", scopeId: enterpriseId } } });
  return enterpriseFlowFromRow(row);
});

const projectRow = cache(async (projectId: string) => prisma.flowConfig.findUnique({ where: { scope_scopeId: { scope: "project", scopeId: projectId } } }));
const projectEnterprise = cache(async (projectId: string) => (await prisma.project.findUnique({ where: { id: projectId }, select: { enterpriseId: true } }))?.enterpriseId ?? null);

/** T54 项目里属于这些岗位的成员（启用的正式账号） */
async function roleReviewers(projectId: string, roles: string[]) {
  if (!roles.length) return [];
  const ms = await prisma.projectMember.findMany({ where: { projectId, user: { isActive: true, demoKind: null, position: { in: roles } } }, select: { user: { select: { id: true, name: true, avatarUrl: true, position: true } } } });
  return ms.map((m) => m.user);
}

/** T54 某项目的评审人：项目指定的优先，否则企业默认评审岗位在本项目里的成员 */
export async function reviewersFor(projectId: string | null) {
  if (!projectId) return [];
  const [entId, row] = await Promise.all([projectEnterprise(projectId), projectRow(projectId)]);
  const own = projectFlowFromRow(row);
  if (own?.reviewerIds?.length) {
    const users = await prisma.user.findMany({ where: { id: { in: own.reviewerIds }, isActive: true, demoKind: null, projectMembers: { some: { projectId } } }, select: { id: true, name: true, avatarUrl: true, position: true } });
    return own.reviewerIds.map((id) => users.find((u) => u.id === id)).filter((u): u is (typeof users)[number] => !!u);
  }
  const ent = await getEnterpriseFlow(entId);
  return roleReviewers(projectId, ent?.reviewerRoles || []);
}

/** 某项目生效的流程 */
export async function flowForProject(projectId: string): Promise<EffectiveFlow> {
  const [sys, entId, row] = await Promise.all([getHiddenStatuses(), projectEnterprise(projectId), projectRow(projectId)]);
  return resolveFlow(sys, await getEnterpriseFlow(entId), projectFlowFromRow(row));
}

/** 某企业（没有项目时，如公共池）生效的流程 */
export async function flowForEnterprise(enterpriseId: string | null): Promise<EffectiveFlow> {
  const sys = await getHiddenStatuses();
  return resolveFlow(sys, enterpriseId ? await getEnterpriseFlow(enterpriseId) : null, null);
}

/** 需求生效的流程：项目需求按项目；公共池按创建人所在企业 */
export async function flowForRequirement(r: { projectId: string | null; creatorId: string }): Promise<EffectiveFlow> {
  if (r.projectId) return flowForProject(r.projectId);
  return flowForEnterprise((await enterpriseOfUserId(r.creatorId)) || null);
}

/** 当前账号默认看到的流程（工作台、公共池等不分项目的地方） */
export async function flowForUser(user: { id: string }): Promise<EffectiveFlow> {
  return flowForEnterprise((await enterpriseOfUserId(user.id)) || null);
}

/** 需求（或它的主需求文档）有没有通过的评审 */
export async function hasApprovedReview(r: { id: string; docPageId: string | null }) {
  const n = await prisma.review.count({ where: { status: "approved", OR: [{ requirementId: r.id }, ...(r.docPageId ? [{ docPageId: r.docPageId }] : [])] } });
  return n > 0;
}

/**
 * 改需求状态前的流程校验：目标状态停用 → 400；要求评审且从需求阶段往后推、没有通过的评审 → 400。
 * 返回错误文字或 null。
 */
export async function checkStatusChange(r: { id: string; projectId: string | null; creatorId: string; docPageId: string | null; status: string }, to: string): Promise<string | null> {
  const flow = await flowForRequirement(r);
  if (flow.hidden.includes(to)) return `「${flowStatusLabel(to, flow.labels)}」阶段已停用，请选择其他阶段`;
  if (flow.reviewRequired && crossesReviewGate(r.status, to) && !(await hasApprovedReview(r))) return REVIEW_GATE_MESSAGE;
  // T43 关卡：缺什么一次说清楚
  const stage = gateStageFor(r.status, to);
  if (stage && flow.gates.length) {
    const { missingGates, GATE_STAGE_LABEL } = await import("./gates");
    const miss = await missingGates(r, stage, flow.gates);
    if (miss.length) return `${GATE_STAGE_LABEL[stage]}前还缺：${miss.join("、")}`;
  }
  return null;
}

/**
 * 自动推进（advanceRequirements）用：目标状态在这个需求的流程里停用就顺延到下一个启用的；
 * 要求评审又没通过的，不能自动离开需求阶段（返回 null = 跳过）。
 */
export async function autoTarget(r: { id: string; projectId: string | null; creatorId: string; docPageId: string | null; status: string }, to: string): Promise<string | null> {
  const flow = await flowForRequirement(r);
  let target = remapHiddenStatus(to, flow.hidden);
  // T43 启用设计环节：从需求阶段自动推到「待开发」时，没有 UI 设计 / 原型的先进「设计中」
  if (flow.designStage && target === "dev_todo" && (r.status === "req_in_progress" || r.status === "req_done")) {
    const { hasDesign } = await import("../requirements/artifacts");
    const parent = await prisma.requirement.findUnique({ where: { id: r.id }, select: { parentId: true } });
    if (!(await hasDesign(r.id, parent?.parentId ?? null))) target = "req_design";
  }
  if (target === r.status) return null;
  if (flow.reviewRequired && crossesReviewGate(r.status, target) && !(await hasApprovedReview(r))) return null;
  const stage = gateStageFor(r.status, target);
  if (stage && flow.gates.length) {
    const { missingGates } = await import("./gates");
    if ((await missingGates(r, stage, flow.gates)).length) return null;
  }
  return target;
}

/**
 * 布局下发给浏览器的流程：base = 本人企业的流程；projects = 和 base 不一样的项目（只含看得到的项目）。
 */
export type ClientFlow = { hidden: string[]; labels: Record<string, string>; reviewRequired: boolean; mode: EffectiveFlow["mode"]; designStage: boolean; gates: GateKey[] };
const clientOf = (f: EffectiveFlow): ClientFlow => ({ hidden: f.hidden, labels: f.labels, reviewRequired: f.reviewRequired, mode: f.mode, designStage: f.designStage, gates: f.gates });

export async function clientFlows(user: SessionUser): Promise<{ base: ClientFlow; projects: Record<string, ClientFlow> }> {
  const base = await flowForUser(user);
  const access = await getAccess(user);
  const rows = await prisma.flowConfig.findMany({ select: { scope: true, scopeId: true } });
  const projIds = rows.filter((r) => r.scope === "project").map((r) => r.scopeId);
  const entIds = rows.filter((r) => r.scope === "enterprise").map((r) => r.scopeId);
  const myEnt = (await enterpriseOfUserId(user.id)) || null;
  const candidates = await prisma.project.findMany({
    where: { AND: [projectWhere(access), { OR: [{ id: { in: projIds } }, { enterpriseId: { in: entIds.filter((e) => e !== myEnt) } }] }] },
    select: { id: true },
    take: 500,
  });
  const projects: Record<string, ClientFlow> = {};
  const b = JSON.stringify(clientOf(base));
  for (const p of candidates) {
    const f = clientOf(await flowForProject(p.id));
    if (JSON.stringify(f) !== b) projects[p.id] = f;
  }
  return { base: clientOf(base), projects };
}

// ---------- 配置读写 ----------

/** 能改哪个企业的流程：系统超管任意企业；企业超管本企业；其他人不能改 */
async function editableEnterprise(session: SessionUser, enterpriseId: string) {
  if (session.isDemo) return false;
  if (session.globalRole === ADMIN_ROLE) return true;
  return (await enterpriseAdminOf(session.id)) === enterpriseId;
}

async function enterprises() {
  return (await listOrgs()).filter((o) => o.type === "enterprise").map((o) => ({ id: o.id, name: o.name }));
}

/** 要看的企业：系统超管可指定；其他人只能是本企业（指定别的企业按不存在） */
async function resolveEnterprise(session: SessionUser, requested: string | null): Promise<string | null> {
  const all = await enterprises();
  if (session.globalRole === ADMIN_ROLE) return requested && all.some((e) => e.id === requested) ? requested : requested ? null : all[0]?.id ?? null;
  const mine = (await enterpriseOfUserId(session.id)) || null;
  if (requested && requested !== mine) return null;
  return mine;
}

async function enterpriseReqWhere(enterpriseId: string) {
  const orgIds = subtreeIds(await listOrgs(), enterpriseId);
  return { OR: [{ project: { enterpriseId } }, { projectId: null, creator: { orgId: { in: orgIds } } }] };
}

async function countByStatus(where: object) {
  const rows = await prisma.requirement.groupBy({ by: ["status"], where, _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
}

/** 新停用、还有需求的状态：按 migrate 给的目标迁移（目标必须启用中），写动态 */
async function migrateHidden(
  session: SessionUser,
  where: object,
  before: string[],
  hidden: string[],
  enabled: string[],
  migrate: Record<string, string> | undefined,
  labels: Record<string, string>,
): Promise<{ error: string } | { moves: { from: string; to: string; count: number }[] }> {
  const n = await countByStatus(where);
  const moves: { from: string; to: string; count: number }[] = [];
  for (const s of hidden) {
    if (!n[s] || before.includes(s)) continue;
    const to = migrate?.[s];
    if (!to || !enabled.includes(to)) return { error: `「${flowStatusLabel(s, labels)}」还有 ${n[s]} 条需求，请选择迁移到哪个阶段` };
    moves.push({ from: s, to, count: n[s] });
  }
  for (const m of moves) {
    const ids = (await prisma.requirement.findMany({ where: { AND: [where, { status: m.from }] }, select: { id: true } })).map((r) => r.id);
    await prisma.requirement.updateMany({ where: { id: { in: ids }, status: m.from }, data: { status: m.to, ...(m.to === "online" ? { actualEndAt: new Date() } : {}) } });
    await prisma.activityLog.createMany({
      data: ids.map((id) => ({
        entityType: "requirement",
        entityId: id,
        action: "status_changed",
        actorId: session.id,
        fromValue: JSON.stringify({ status: m.from }),
        toValue: JSON.stringify({ status: m.to }),
        message: `流程停用「${flowStatusLabel(m.from, labels)}」，迁移到「${flowStatusLabel(m.to, labels)}」`,
      })),
    });
  }
  return { moves };
}

/** GET 企业流程：?enterpriseId= 只对系统超管有效 */
export async function enterpriseGET(session: SessionUser, requested: string | null) {
  const enterpriseId = await resolveEnterprise(session, requested);
  const isAdmin = session.globalRole === ADMIN_ROLE;
  if (!enterpriseId) {
    if (requested) return result({ error: "企业不存在" }, { status: 404 });
    return result({ enterpriseId: null, enterprises: isAdmin ? await enterprises() : [], canEdit: false });
  }
  const [flow, sys] = await Promise.all([getEnterpriseFlow(enterpriseId), getHiddenStatuses()]);
  const canEdit = await editableEnterprise(session, enterpriseId);
  const projects = await prisma.flowConfig.findMany({ where: { scope: "project", scopeId: { in: (await prisma.project.findMany({ where: { enterpriseId }, select: { id: true } })).map((p) => p.id) } }, select: { scopeId: true, hiddenStatuses: true, reviewRequired: true } });
  const names = new Map((await prisma.project.findMany({ where: { id: { in: projects.map((p) => p.scopeId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return result({
    enterpriseId,
    enterprises: isAdmin ? await enterprises() : (await enterprises()).filter((e) => e.id === enterpriseId),
    flow,
    systemHidden: sys,
    locked: LOCKED_REQ_STATUSES,
    counts: canEdit ? await countByStatus(await enterpriseReqWhere(enterpriseId)) : {},
    overrides: canEdit ? projects.map((p) => ({ projectId: p.scopeId, name: names.get(p.scopeId) || p.scopeId, hidden: parseHiddenStatuses(p.hiddenStatuses), reviewRequired: p.reviewRequired })) : [],
    canEdit,
  });
}

/** PUT 企业流程 { enterpriseId?, hidden, labels, reviewRequired, allowProjectStages, allowProjectReview, migrate } */
export async function enterprisePUT(session: SessionUser, body: Record<string, unknown>) {
  const enterpriseId = await resolveEnterprise(session, body.enterpriseId ? String(body.enterpriseId) : null);
  if (!enterpriseId) return result({ error: "企业不存在" }, { status: 404 });
  if (!(await editableEnterprise(session, enterpriseId))) return result({ error: "只有企业超管或系统超管可以配置企业流程" }, { status: 403 });
  const before = (await getEnterpriseFlow(enterpriseId))!;
  const sys = await getHiddenStatuses();
  const hidden = parseHiddenStatuses(body.hidden ?? before.hidden).filter((s) => !sys.includes(s));
  const labels = parseLabels(body.labels ?? before.labels);
  const conflict = labelConflict(labels);
  if (conflict) return result({ error: conflict }, { status: 400 });
  const designStage = typeof body.designStage === "boolean" ? body.designStage : before.designStage;
  // 关掉设计环节 = 「设计中」停用：还在设计中的需求默认迁到「待开发」
  const hiddenEff = designStage ? hidden : [...hidden, "req_design"];
  const beforeEff = [...before.hidden, ...sys, ...(before.designStage ? [] : ["req_design"])];
  const enabled = ALL.filter((s) => !hiddenEff.includes(s) && !sys.includes(s));
  const migrate = { req_design: "dev_todo", ...((body.migrate as Record<string, string> | undefined) || {}) };
  const moved = await migrateHidden(session, await enterpriseReqWhere(enterpriseId), beforeEff, hiddenEff, enabled, migrate, labels);
  if ("error" in moved) return result({ error: moved.error }, { status: 400 });
  const data = {
    hiddenStatuses: JSON.stringify(hidden),
    statusLabels: JSON.stringify(labels),
    reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : before.reviewRequired,
    allowProjectStages: typeof body.allowProjectStages === "boolean" ? body.allowProjectStages : before.allowProjectStages,
    allowProjectReview: typeof body.allowProjectReview === "boolean" ? body.allowProjectReview : before.allowProjectReview,
    mode: isFlowMode(body.mode) ? body.mode : before.mode,
    designStage,
    gates: JSON.stringify(body.gates !== undefined ? parseGates(body.gates) : before.gates),
    allowProjectMode: typeof body.allowProjectMode === "boolean" ? body.allowProjectMode : before.allowProjectMode,
    allowProjectGates: typeof body.allowProjectGates === "boolean" ? body.allowProjectGates : before.allowProjectGates,
    reviewerRoles: JSON.stringify(body.reviewerRoles !== undefined ? parseIdList(body.reviewerRoles) : before.reviewerRoles),
    updatedById: session.id,
  };
  // T54：启用需求评审必须配评审人（默认评审岗位）
  if (data.reviewRequired && !parseIdList(data.reviewerRoles).length) return result({ error: "启用需求评审要先选默认评审岗位（至少一个）" }, { status: 400 });
  await prisma.flowConfig.upsert({ where: { scope_scopeId: { scope: "enterprise", scopeId: enterpriseId } }, create: { scope: "enterprise", scopeId: enterpriseId, ...data }, update: data });
  await prisma.activityLog.create({ data: { entityType: "organization", entityId: enterpriseId, action: "flow_config", actorId: session.id, message: `更新研发流程：停用 ${hidden.length} 个状态，${data.reviewRequired ? "需求必须评审" : "评审不强制"}，模式 ${data.mode}，设计环节${designStage ? "启用" : "不启用"}，关卡 ${parseGates(data.gates).length} 项` } });
  return result({ ok: true, migrated: moved.moves });
}

/** 项目流程：看得到项目才能读；有「编辑项目」权限且企业允许才能改 */
export async function projectGET(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  const entId = await projectEnterprise(projectId);
  const [ent, sys, row, flow] = await Promise.all([getEnterpriseFlow(entId), getHiddenStatuses(), projectRow(projectId), flowForProject(projectId)]);
  const own = projectFlowFromRow(row);
  const canEdit = !session.isDemo && (await can(session, "project.edit", projectId));
  return result({
    projectId,
    inherited: { hidden: Array.from(new Set([...sys, ...(ent?.hidden || [])])), labels: ent?.labels || {}, reviewRequired: Boolean(ent?.reviewRequired), mode: ent?.mode || "kanban", designStage: Boolean(ent?.designStage), gates: ent?.gates || [], reviewerRoles: ent?.reviewerRoles || [] },
    allowStages: ent ? ent.allowProjectStages : true,
    allowReview: ent ? ent.allowProjectReview : true,
    allowMode: ent ? ent.allowProjectMode : true,
    allowGates: ent ? ent.allowProjectGates : true,
    own: own || { hidden: [], reviewRequired: null, mode: null, designStage: null, gates: [], reviewerIds: [] },
    reviewerRoles: ent?.reviewerRoles || [],
    reviewers: (await reviewersFor(projectId)).map((u) => ({ id: u.id, name: u.name })),
    members: canEdit ? (await prisma.projectMember.findMany({ where: { projectId, user: { isActive: true, demoKind: null } }, select: { user: { select: { id: true, name: true, position: true } } } })).map((m) => m.user) : [],
    effective: flow,
    locked: LOCKED_REQ_STATUSES,
    counts: canEdit ? await countByStatus({ projectId }) : {},
    canEdit,
  });
}

export async function projectPUT(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (session.isDemo || !(await can(session, "project.edit", projectId))) return result({ error: "无权限修改项目流程" }, { status: 403 });
  const entId = await projectEnterprise(projectId);
  const [ent, sys, row] = await Promise.all([getEnterpriseFlow(entId), getHiddenStatuses(), projectRow(projectId)]);
  const before = projectFlowFromRow(row) || { hidden: [], reviewRequired: null };
  const allowStages = ent ? ent.allowProjectStages : true;
  const allowReview = ent ? ent.allowProjectReview : true;
  const inherited = Array.from(new Set([...sys, ...(ent?.hidden || [])]));
  let hidden = before.hidden;
  if (body.hidden !== undefined) {
    if (!allowStages) return result({ error: "企业不允许项目单独停用状态" }, { status: 403 });
    hidden = parseHiddenStatuses(body.hidden).filter((s) => !inherited.includes(s));
  }
  let reviewRequired = before.reviewRequired;
  if (body.reviewRequired !== undefined) {
    if (!allowReview) return result({ error: "企业不允许项目单独设置评审" }, { status: 403 });
    reviewRequired = typeof body.reviewRequired === "boolean" ? body.reviewRequired : null;
  }
  const allowMode = ent ? ent.allowProjectMode : true;
  const allowGates = ent ? ent.allowProjectGates : true;
  let mode = before.mode ?? null;
  let designStage = before.designStage ?? null;
  if (body.mode !== undefined || body.designStage !== undefined) {
    if (!allowMode) return result({ error: "企业不允许项目单独选择研发模式或设计环节" }, { status: 403 });
    if (body.mode !== undefined) mode = isFlowMode(body.mode) ? body.mode : null;
    if (body.designStage !== undefined) designStage = typeof body.designStage === "boolean" ? body.designStage : null;
  }
  let gates = before.gates || [];
  if (body.gates !== undefined) {
    if (!allowGates) return result({ error: "企业不允许项目再加关卡" }, { status: 403 });
    gates = parseGates(body.gates).filter((g) => !(ent?.gates || []).includes(g));
  }
  const designOn = designStage ?? Boolean(ent?.designStage);
  const beforeDesign = before.designStage ?? Boolean(ent?.designStage);
  const hiddenEff = designOn ? hidden : [...hidden, "req_design"];
  const enabled = ALL.filter((s) => !hiddenEff.includes(s) && !inherited.includes(s));
  const migrate = { req_design: "dev_todo", ...((body.migrate as Record<string, string> | undefined) || {}) };
  const moved = await migrateHidden(session, { projectId }, [...before.hidden, ...inherited, ...(beforeDesign ? [] : ["req_design"])], hiddenEff, enabled, migrate, ent?.labels || {});
  if ("error" in moved) return result({ error: moved.error }, { status: 400 });
  let reviewerIds = before.reviewerIds || [];
  if (body.reviewerIds !== undefined) {
    if (!allowReview) return result({ error: "企业不允许项目单独设置评审" }, { status: 403 });
    reviewerIds = parseIdList(body.reviewerIds);
    const members = new Set((await prisma.projectMember.findMany({ where: { projectId, userId: { in: reviewerIds }, user: { isActive: true, demoKind: null } }, select: { userId: true } })).map((m) => m.userId));
    if (reviewerIds.some((id) => !members.has(id))) return result({ error: "评审人必须是这个项目的成员" }, { status: 400 });
  }
  // T54：启用评审后必须能找到评审人（项目指定的，或项目里有企业默认评审岗位的人）
  const reviewOn = reviewRequired ?? Boolean(ent?.reviewRequired);
  if (reviewOn && !reviewerIds.length && !(await roleReviewers(projectId, ent?.reviewerRoles || [])).length)
    return result({ error: ent?.reviewerRoles?.length ? "项目里没有默认评审岗位的成员，请指定评审人" : "启用需求评审要指定评审人" }, { status: 400 });
  const data = { hiddenStatuses: JSON.stringify(hidden), reviewRequired, mode, designStage, gates: JSON.stringify(gates), reviewerIds: JSON.stringify(reviewerIds), updatedById: session.id };
  if (!hidden.length && reviewRequired === null && mode === null && designStage === null && !gates.length && !reviewerIds.length) await prisma.flowConfig.deleteMany({ where: { scope: "project", scopeId: projectId } });
  else await prisma.flowConfig.upsert({ where: { scope_scopeId: { scope: "project", scopeId: projectId } }, create: { scope: "project", scopeId: projectId, ...data }, update: data });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "flow_config", actorId: session.id, message: `更新项目流程：另停用 ${hidden.length} 个状态，评审${reviewRequired === null ? "跟随企业" : reviewRequired ? "必须" : "不强制"}` } });
  return result({ ok: true, migrated: moved.moves });
}
