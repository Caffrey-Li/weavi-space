import { reqCodeOf } from "../shared/codes";
import type { SessionUser } from "../auth";
import { result } from "./result";
import { can } from "../permissions";
import { getAccess, requirementWhere } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { PRIORITY_LABELS, PRIORITY_OPTIONS, REQUIREMENT_ASSIGNEE_SLOTS } from "../shared/constants";
import { applyAssignees, parseDate } from "../requirement-write";


const MAX = 200;
type Patch = { assignees?: Record<string, string | null>; startAt?: string | null; plannedEndAt?: string | null; priority?: string };

const code = (r: { number: number }) => (reqCodeOf(r));

/**
 * 需求批量设置（Figma 50）：负责人各槽位、开始日期、计划完成、优先级。
 * POST { ids, patch, dryRun? }：字段没出现在 patch 里就不修改；负责人值为 null 表示清空。
 * 逐条校验编辑权限和「负责人需是该项目成员」，不满足的跳过并返回原因。
 */

export async function POST(session: SessionUser, body: { ids?: unknown; patch?: Patch; dryRun?: boolean }) {
  const ids = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String))).slice(0, MAX) : [];
  if (!ids.length) return result({ error: "请先选择需求" }, { status: 400 });
  const patch = body.patch || {};

  // 入参整理
  const slots = REQUIREMENT_ASSIGNEE_SLOTS.map((s) => s.key as string);
  const assignees: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(patch.assignees || {})) if (slots.includes(k)) assignees[k] = v ? String(v) : null;
  const data: Record<string, unknown> = {};
  if ("startAt" in patch) data.startAt = patch.startAt ? parseDate(patch.startAt) : null;
  if ("plannedEndAt" in patch) data.plannedEndAt = patch.plannedEndAt ? parseDate(patch.plannedEndAt) : null;
  if (patch.startAt && !data.startAt) return result({ error: "开始日期无效" }, { status: 400 });
  if (patch.plannedEndAt && !data.plannedEndAt) return result({ error: "计划完成日期无效" }, { status: 400 });
  if (data.startAt && data.plannedEndAt && (data.startAt as Date) > (data.plannedEndAt as Date)) return result({ error: "开始日期不能晚于计划完成" }, { status: 400 });
  if (patch.priority !== undefined) {
    const p = String(patch.priority).toLowerCase();
    if (!(PRIORITY_OPTIONS as readonly string[]).includes(p)) return result({ error: "优先级无效" }, { status: 400 });
    data.priority = p;
  }
  if (!Object.keys(assignees).length && !Object.keys(data).length) return result({ error: "没有要修改的字段" }, { status: 400 });

  const rows = await prisma.requirement.findMany({
    where: { id: { in: ids }, AND: [requirementWhere(await getAccess(session))] },
    select: { id: true, number: true, projectId: true, startAt: true, plannedEndAt: true, project: { select: { key: true, name: true } } },
  });
  const userIds = Array.from(new Set(Object.values(assignees).filter((v): v is string => Boolean(v))));
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, name: true } });
  if (users.length !== userIds.length) return result({ error: "负责人不存在或已停用" }, { status: 400 });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const members = userIds.length
    ? await prisma.projectMember.findMany({ where: { userId: { in: userIds }, projectId: { in: rows.map((r) => r.projectId).filter((x): x is string => Boolean(x)) } }, select: { projectId: true, userId: true } })
    : [];
  const isMember = new Set(members.map((m) => `${m.projectId}:${m.userId}`));
  const permCache = new Map<string, boolean>();

  const ok: string[] = [];
  const skipped: { id: string; code: string; reason: string }[] = [];
  for (const r of rows) {
    const key = r.projectId || "";
    if (!permCache.has(key)) permCache.set(key, await can(session, "requirements.edit", r.projectId || undefined));
    if (!permCache.get(key)) {
      skipped.push({ id: r.id, code: code(r), reason: "没有编辑权限" });
      continue;
    }
    // 项目内的需求：负责人必须是该项目成员（公共池需求不限）
    const notMember = r.projectId ? userIds.filter((u) => !isMember.has(`${r.projectId}:${u}`)) : [];
    if (notMember.length) {
      skipped.push({ id: r.id, code: code(r), reason: `${notMember.map((u) => nameOf.get(u)).join("、")}不是「${r.project?.name}」的成员` });
      continue;
    }
    const start = "startAt" in data ? (data.startAt as Date | null) : r.startAt;
    const end = "plannedEndAt" in data ? (data.plannedEndAt as Date | null) : r.plannedEndAt;
    if (start && end && start > end) {
      skipped.push({ id: r.id, code: code(r), reason: "开始日期会晚于计划完成" });
      continue;
    }
    ok.push(r.id);
  }
  if (body.dryRun) return result({ ok: ok.length, skipped });

  // 动态里写清楚改了什么
  const parts: string[] = [];
  for (const [k, v] of Object.entries(assignees)) parts.push(`${REQUIREMENT_ASSIGNEE_SLOTS.find((s) => s.key === k)!.label}→${v ? nameOf.get(v) : "清空"}`);
  if ("startAt" in data) parts.push(`开始日期→${patch.startAt ? String(patch.startAt).slice(0, 10) : "清空"}`);
  if ("plannedEndAt" in data) parts.push(`计划完成→${patch.plannedEndAt ? String(patch.plannedEndAt).slice(0, 10) : "清空"}`);
  if (data.priority) parts.push(`优先级→${PRIORITY_LABELS[data.priority as string].label}`);
  for (const id of ok) {
    if (Object.keys(data).length) await prisma.requirement.update({ where: { id }, data });
    else await prisma.requirement.update({ where: { id }, data: { updatedAt: new Date() } });
    if (Object.keys(assignees).length) await applyAssignees(id, assignees);
    await prisma.activityLog.create({ data: { entityType: "requirement", entityId: id, action: "updated", actorId: session.id, message: `批量设置：${parts.join("，")}` } });
  }
  return result({ updated: ok.length, skipped });
}
