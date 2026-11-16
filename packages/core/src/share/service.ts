import { createHash, randomBytes } from "crypto";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { canSeeProject } from "../access";
import { can } from "../permissions";
import { result } from "../nova/result";
import { REQ_STATUS, RELEASE_STATUS } from "../shared/constants";

/**
 * 项目只读分享链接（不需要登录）：能编辑项目的人创建 / 作废；链接里是随机令牌，库里只存哈希。
 * 分享页只给项目名、进度、需求标题和状态、发版计划，不带人名、负责人、描述正文和内部 id。
 */
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const MAX_ACTIVE = 20;
const DAY = 24 * 60 * 60 * 1000;

async function guard(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (!(await can(session, "project.edit", projectId))) return result({ error: "需要「编辑项目」权限才能管理分享链接" }, { status: 403 });
  return null;
}

const view = (l: { id: string; label: string; expiresAt: Date | null; revokedAt: Date | null; viewCount: number; lastViewedAt: Date | null; createdAt: Date }) => ({
  id: l.id,
  label: l.label,
  expiresAt: l.expiresAt?.toISOString() ?? null,
  revoked: Boolean(l.revokedAt),
  expired: Boolean(l.expiresAt && l.expiresAt.getTime() <= Date.now()),
  viewCount: l.viewCount,
  lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
  createdAt: l.createdAt.toISOString(),
});

export async function listShareLinks(session: SessionUser, projectId: string) {
  const denied = await guard(session, projectId);
  if (denied) return denied;
  const rows = await prisma.projectShareLink.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 });
  return result({ links: rows.map(view) });
}

/** body: { label?, days?: 7 | 30 | 90 | 0（0 = 不过期） } → 明文令牌只在这里返回一次 */
export async function createShareLink(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const denied = await guard(session, projectId);
  if (denied) return denied;
  const days = Number(body.days ?? 30);
  if (![0, 7, 30, 90].includes(days)) return result({ error: "有效期只能选 7 天、30 天、90 天或不过期" }, { status: 400 });
  const label = String(body.label || "").trim().slice(0, 60);
  const active = await prisma.projectShareLink.count({ where: { projectId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (active >= MAX_ACTIVE) return result({ error: `每个项目最多 ${MAX_ACTIVE} 个有效链接，请先作废不用的` }, { status: 400 });
  const token = randomBytes(24).toString("base64url");
  const row = await prisma.projectShareLink.create({
    data: { projectId, tokenHash: hash(token), label, createdById: session.id, expiresAt: days ? new Date(Date.now() + days * DAY) : null },
  });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "share_link.create", actorId: session.id, message: label ? `创建分享链接「${label}」` : "创建分享链接" } }).catch(() => undefined);
  return result({ link: view(row), token });
}

export async function revokeShareLink(session: SessionUser, projectId: string, id: string) {
  const denied = await guard(session, projectId);
  if (denied) return denied;
  const r = await prisma.projectShareLink.updateMany({ where: { id, projectId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) return result({ error: "链接不存在或已作废" }, { status: 404 });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "share_link.revoke", actorId: session.id, message: "作废分享链接" } }).catch(() => undefined);
  return result({ ok: true });
}

/** 分享页读数据：令牌无效、过期、作废、项目归档都按「不存在」处理 */
export async function loadSharedProject(token: string) {
  if (!token || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const link = await prisma.projectShareLink.findUnique({ where: { tokenHash: hash(token) } });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt.getTime() <= Date.now())) return null;
  const project = await prisma.project.findUnique({ where: { id: link.projectId }, select: { id: true, name: true, description: true, status: true, plannedEndAt: true, archivedAt: true } });
  if (!project || project.archivedAt) return null;
  const [reqs, releases] = await Promise.all([
    prisma.requirement.findMany({
      where: { projectId: project.id, archivedAt: null, parentId: null, status: { not: "cancelled" } },
      select: { title: true, status: true, priority: true, plannedEndAt: true },
      orderBy: [{ plannedEndAt: "asc" }, { createdAt: "asc" }],
      take: 300,
    }),
    prisma.release.findMany({ where: { projectId: project.id, status: { not: "cancelled" } }, select: { version: true, title: true, status: true, plannedAt: true, releasedAt: true }, orderBy: [{ plannedAt: "desc" }], take: 20 }),
  ]);
  await prisma.projectShareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } }).catch(() => undefined);
  const label = (k: string) => REQ_STATUS.find((s) => s.key === k)?.label || k;
  const stages = REQ_STATUS.filter((s) => s.key !== "cancelled").map((s) => ({ key: s.key, label: s.label, count: reqs.filter((r) => r.status === s.key).length }));
  const done = reqs.filter((r) => r.status === "online").length;
  return {
    project: { name: project.name, description: project.description, plannedEndAt: project.plannedEndAt?.toISOString() ?? null },
    total: reqs.length,
    done,
    progress: reqs.length ? Math.round((done / reqs.length) * 100) : 0,
    stages: stages.filter((s) => s.count > 0),
    requirements: reqs.map((r) => ({ title: r.title, status: r.status, statusLabel: label(r.status), priority: r.priority, plannedEndAt: r.plannedEndAt?.toISOString() ?? null })),
    releases: releases.map((r) => ({ version: r.version, title: r.title, statusLabel: RELEASE_STATUS[r.status]?.label || r.status, plannedAt: r.plannedAt?.toISOString() ?? null, releasedAt: r.releasedAt?.toISOString() ?? null })),
    expiresAt: link.expiresAt?.toISOString() ?? null,
  };
}
