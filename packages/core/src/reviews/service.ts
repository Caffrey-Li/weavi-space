import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { result } from "../nova/result";
import { can } from "../permissions";
import { getAccess, requirementVisible, userWhere } from "../access";
import { canEditDocs, canViewSpace } from "../docs/docs-query";
import { advanceRequirements } from "../requirements/flow";

/**
 * T38 需求评审：在需求或文档页上「发起评审」，选评审人和截止日期；每位评审人给 通过 / 有条件通过 / 不通过 + 意见。
 * - 有人不通过 → 立即退回（rejected），通知发起人和需求提出人，文档状态回到「草稿」；
 * - 所有人都给了结论且没有不通过 → 通过（approved），文档标「评审通过」，需求从「需求中」推进到「需求完成」；
 * - 同一个对象同时只能有一个进行中的评审；发起人或有编辑权限的人可以取消。
 * 权限：能看到对象才能看评审；发起 / 取消要有编辑权限（需求 requirements.edit，文档 docs.edit）；只有被指定的评审人能给结论。
 */
export const VERDICTS = ["approve", "conditional", "reject"] as const;
export const VERDICT_LABEL: Record<string, string> = { pending: "未评", approve: "通过", conditional: "有条件通过", reject: "不通过" };
export const REVIEW_STATUS_LABEL: Record<string, string> = { open: "评审中", approved: "评审通过", rejected: "评审退回", cancelled: "已取消" };

type Target = { requirementId: string | null; docPageId: string | null; projectId: string | null; title: string; href: string; canStart: boolean; proposerIds: string[]; docVersion: number | null };

/** 解析评审对象并校验可见性；看不到 / 不存在返回 null（按 404） */
async function target(session: SessionUser, raw: { requirementId?: unknown; docPageId?: unknown }): Promise<Target | null> {
  const requirementId = raw.requirementId ? String(raw.requirementId) : null;
  const docPageId = raw.docPageId ? String(raw.docPageId) : null;
  if (requirementId) {
    if (!(await requirementVisible(session, requirementId))) return null;
    const r = await prisma.requirement.findFirst({ where: { id: requirementId, deletedAt: null }, select: { id: true, title: true, projectId: true, docPageId: true, creatorId: true, proposerId: true } });
    if (!r) return null;
    const page = r.docPageId ? await prisma.docPage.findFirst({ where: { id: r.docPageId, deletedAt: null }, select: { id: true, version: true, projectId: true } }) : null;
    const pageOk = page && (await canViewSpace(session, page.projectId));
    return { requirementId: r.id, docPageId: pageOk ? page!.id : null, projectId: r.projectId, title: r.title, href: `/requirements/${r.id}`, canStart: await can(session, "requirements.edit", r.projectId), proposerIds: [r.creatorId, r.proposerId].filter((x): x is string => Boolean(x)), docVersion: pageOk ? page!.version : null };
  }
  if (docPageId) {
    const p = await prisma.docPage.findFirst({ where: { id: docPageId, deletedAt: null }, select: { id: true, title: true, projectId: true, version: true, creatorId: true } });
    if (!p || !(await canViewSpace(session, p.projectId))) return null;
    return { requirementId: null, docPageId: p.id, projectId: p.projectId, title: p.title || "无标题", href: `/docs/${p.projectId}/pages/${p.id}`, canStart: await canEditDocs(session, p.projectId), proposerIds: [p.creatorId], docVersion: p.version };
  }
  return null;
}

/** 能被选为评审人的人：有项目时是项目成员，公共池需求是本企业的人；都要是启用的正式账号 */
async function candidateUsers(session: SessionUser, projectId: string | null) {
  const base = { isActive: true, demoKind: null };
  if (projectId) {
    const ms = await prisma.projectMember.findMany({ where: { projectId, user: base }, select: { user: { select: { id: true, name: true, avatarUrl: true } } } });
    return ms.map((m) => m.user);
  }
  return prisma.user.findMany({ where: { ...base, AND: [userWhere(await getAccess(session))] }, select: { id: true, name: true, avatarUrl: true }, orderBy: { name: "asc" }, take: 300 });
}

/** 需求和它的主需求文档共用评审：在任一处发起的，两边都看得到 */
function reviewWhere(t: Target) {
  if (t.requirementId) return t.docPageId ? { OR: [{ requirementId: t.requirementId }, { docPageId: t.docPageId }] } : { requirementId: t.requirementId };
  return { docPageId: t.docPageId };
}

async function view(session: SessionUser, t: Target) {
  const rows = await prisma.review.findMany({ where: reviewWhere(t), include: { votes: true }, orderBy: { createdAt: "desc" }, take: 10 });
  const ids = Array.from(new Set(rows.flatMap((r) => [r.createdById, ...r.votes.map((v) => v.userId)])));
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUrl: true } });
  const u = new Map(users.map((x) => [x.id, x]));
  return {
    canStart: t.canStart,
    title: t.title,
    reviews: rows.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note,
      status: r.status,
      statusLabel: REVIEW_STATUS_LABEL[r.status] || r.status,
      docVersion: r.docVersion,
      dueAt: r.dueAt?.toISOString().slice(0, 10) || null,
      overdue: r.status === "open" && Boolean(r.dueAt && r.dueAt.getTime() < Date.now()),
      createdAt: r.createdAt.toISOString(),
      closedAt: r.closedAt?.toISOString() || null,
      creator: u.get(r.createdById)?.name || "—",
      canCancel: r.status === "open" && (r.createdById === session.id || t.canStart),
      votes: r.votes.map((v) => ({ userId: v.userId, name: u.get(v.userId)?.name || "—", avatarUrl: u.get(v.userId)?.avatarUrl || null, verdict: v.verdict, verdictLabel: VERDICT_LABEL[v.verdict] || v.verdict, comment: v.comment, decidedAt: v.decidedAt?.toISOString() || null })),
      myVote: r.votes.find((v) => v.userId === session.id)?.verdict ?? null,
    })),
  };
}

export async function listReviews(session: SessionUser, q: { requirementId?: string | null; docPageId?: string | null }) {
  const t = await target(session, q);
  if (!t) return result({ error: "评审对象不存在" }, { status: 404 });
  return result(await view(session, t));
}

export async function reviewCandidates(session: SessionUser, q: { requirementId?: string | null; docPageId?: string | null }) {
  const t = await target(session, q);
  if (!t) return result({ error: "评审对象不存在" }, { status: 404 });
  return result({ users: await candidateUsers(session, t.projectId) });
}

/** 我待评的（工作台、通知用） */
export async function myPendingReviews(session: SessionUser) {
  const votes = await prisma.reviewVote.findMany({ where: { userId: session.id, verdict: "pending", review: { status: "open" } }, include: { review: true }, orderBy: { review: { createdAt: "desc" } }, take: 20 });
  return result({ items: votes.map((v) => ({ id: v.review.id, title: v.review.title, requirementId: v.review.requirementId, docPageId: v.review.docPageId, projectId: v.review.projectId, dueAt: v.review.dueAt?.toISOString().slice(0, 10) || null })) });
}

async function notify(userIds: string[], actorId: string, title: string, body: string, href: string, entity: { type: string; id: string }) {
  const ids = Array.from(new Set(userIds.filter((x) => x && x !== actorId)));
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, kind: "review", title: title.slice(0, 200), body: body.slice(0, 500), href, entityType: entity.type, entityId: entity.id, actorId })) });
}

/** 发起：{ requirementId? | docPageId?, reviewerIds, dueAt?, note?, title? } */
export async function startReview(session: SessionUser, body: Record<string, unknown>) {
  const t = await target(session, body);
  if (!t) return result({ error: "评审对象不存在" }, { status: 404 });
  if (!t.canStart) return result({ error: t.requirementId ? "没有编辑这条需求的权限" : "没有编辑这篇文档的权限" }, { status: 403 });
  const reviewerIds = Array.isArray(body.reviewerIds) ? Array.from(new Set(body.reviewerIds.map(String))) : [];
  if (!reviewerIds.length) return result({ error: "请至少选一位评审人" }, { status: 400 });
  if (reviewerIds.length > 20) return result({ error: "评审人最多 20 位" }, { status: 400 });
  const allowed = new Set((await candidateUsers(session, t.projectId)).map((x) => x.id));
  if (reviewerIds.some((id) => !allowed.has(id))) return result({ error: "评审人必须是这个项目的成员（公共池需求为本企业的人）" }, { status: 400 });
  let dueAt: Date | null = null;
  if (body.dueAt) {
    const m = String(body.dueAt).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return result({ error: "截止日期格式不对" }, { status: 400 });
    dueAt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  }
  if (await prisma.review.findFirst({ where: { ...reviewWhere(t), status: "open" }, select: { id: true } })) return result({ error: "已经有一个进行中的评审，先完成或取消它" }, { status: 409 });
  const title = String(body.title || "").trim().slice(0, 120) || `评审：${t.title}`.slice(0, 120);
  const note = String(body.note || "").trim().slice(0, 1000) || null;
  const review = await prisma.review.create({
    data: { requirementId: t.requirementId, docPageId: t.docPageId, projectId: t.projectId, title, note, docVersion: t.docVersion, dueAt, createdById: session.id, votes: { create: reviewerIds.map((userId) => ({ userId })) } },
  });
  if (t.docPageId) await prisma.docPage.updateMany({ where: { id: t.docPageId }, data: { statusTag: "review" } });
  await prisma.activityLog.create({ data: { entityType: "review", entityId: review.id, action: "review_started", actorId: session.id, message: `发起评审「${title}」，${reviewerIds.length} 位评审人`, toValue: JSON.stringify({ requirementId: t.requirementId, docPageId: t.docPageId }) } });
  if (t.requirementId) await prisma.activityLog.create({ data: { entityType: "requirement", entityId: t.requirementId, action: "review_started", actorId: session.id, message: `发起了需求评审（${reviewerIds.length} 位评审人${dueAt ? `，${String(body.dueAt)} 截止` : ""}）` } });
  await notify(reviewerIds, session.id, `请评审：${t.title}`, `${session.name} 邀请你评审${dueAt ? `，${String(body.dueAt)} 前给出结论` : ""}${note ? `。要点：${note}` : ""}`, t.href, { type: t.requirementId ? "requirement" : "doc", id: t.requirementId || t.docPageId! });
  return result({ id: review.id });
}

/** 对已有评审的操作：{ action: "vote", verdict, comment } | { action: "cancel" } */
export async function reviewAction(session: SessionUser, id: string, body: Record<string, unknown>) {
  const review = await prisma.review.findUnique({ where: { id }, include: { votes: true } });
  const t = review ? await target(session, review.requirementId ? { requirementId: review.requirementId } : { docPageId: review.docPageId }) : null;
  if (!review || !t) return result({ error: "评审不存在" }, { status: 404 });
  if (review.status !== "open") return result({ error: "这个评审已经结束" }, { status: 409 });

  if (body.action === "cancel") {
    if (review.createdById !== session.id && !t.canStart) return result({ error: "只有发起人或有编辑权限的人可以取消" }, { status: 403 });
    const done = await prisma.review.updateMany({ where: { id, status: "open" }, data: { status: "cancelled", closedAt: new Date() } });
    if (!done.count) return result({ error: "这个评审已经结束" }, { status: 409 });
    if (review.docPageId) await prisma.docPage.updateMany({ where: { id: review.docPageId, statusTag: "review" }, data: { statusTag: "draft" } });
    await prisma.activityLog.create({ data: { entityType: "review", entityId: id, action: "review_cancelled", actorId: session.id, message: `取消了评审「${review.title}」` } });
    return result({ ok: true, status: "cancelled" });
  }

  if (body.action !== "vote") return result({ error: "未知操作" }, { status: 400 });
  const mine = review.votes.find((v) => v.userId === session.id);
  if (!mine) return result({ error: "你不是这次评审的评审人" }, { status: 403 });
  const verdict = String(body.verdict || "");
  if (!(VERDICTS as readonly string[]).includes(verdict)) return result({ error: "请选择评审结论" }, { status: 400 });
  const comment = String(body.comment || "").trim().slice(0, 2000) || null;
  if (verdict !== "approve" && !comment) return result({ error: verdict === "reject" ? "不通过要写明原因" : "有条件通过要写明条件" }, { status: 400 });
  await prisma.reviewVote.update({ where: { id: mine.id }, data: { verdict, comment, decidedAt: new Date() } });
  await prisma.activityLog.create({ data: { entityType: "review", entityId: id, action: "review_voted", actorId: session.id, message: `评审结论：${VERDICT_LABEL[verdict]}${comment ? `。${comment.slice(0, 200)}` : ""}` } });

  const votes = review.votes.map((v) => (v.id === mine.id ? { ...v, verdict } : v));
  const notifyTo = [review.createdById, ...t.proposerIds];
  const entity = { type: t.requirementId ? "requirement" : "doc", id: t.requirementId || t.docPageId! };
  if (verdict === "reject") {
    const done = await prisma.review.updateMany({ where: { id, status: "open" }, data: { status: "rejected", closedAt: new Date() } });
    if (done.count) {
      if (review.docPageId) await prisma.docPage.updateMany({ where: { id: review.docPageId, statusTag: "review" }, data: { statusTag: "draft" } });
      if (t.requirementId) await prisma.activityLog.create({ data: { entityType: "requirement", entityId: t.requirementId, action: "review_rejected", actorId: session.id, message: `需求评审不通过：${comment?.slice(0, 200) || ""}` } });
      await notify(notifyTo, session.id, `评审退回：${t.title}`, `${session.name} 不通过：${comment || ""}`, t.href, entity);
    }
    return result({ ok: true, status: "rejected" });
  }
  if (votes.every((v) => v.verdict !== "pending")) {
    const done = await prisma.review.updateMany({ where: { id, status: "open" }, data: { status: "approved", closedAt: new Date() } });
    if (done.count) {
      if (review.docPageId) await prisma.docPage.updateMany({ where: { id: review.docPageId }, data: { statusTag: "approved" } });
      // 需求往前推：从需求发起的推这条；从文档发起的推以这篇为主需求文档的需求
      const reqIds = t.requirementId ? [t.requirementId] : review.docPageId ? (await prisma.requirement.findMany({ where: { docPageId: review.docPageId, deletedAt: null }, select: { id: true } })).map((r) => r.id) : [];
      if (reqIds.length) await advanceRequirements(session.id, reqIds, "req_done", "需求评审通过");
      const conds = votes.filter((v) => v.verdict === "conditional").length;
      await notify(notifyTo, session.id, `评审通过：${t.title}`, conds ? `全部评审人已给结论，其中 ${conds} 位有条件通过，请按意见补充。` : "全部评审人通过。", t.href, entity);
    }
    return result({ ok: true, status: "approved" });
  }
  return result({ ok: true, status: "open" });
}
