import type { SessionUser } from "../auth";
import { result } from "./result";
import { can } from "../permissions";
import { getAccess, requirementWhere } from "../access";
import { prisma } from "@pm-collab/db/prisma";
import { alignToProjects } from "../shared/cascade";
import { trash } from "../shared/lifecycle";
import { SEVERITY_OPTIONS } from "../shared/constants";


const MAX = 100;
const code = (r: { id: string; project: { key: string } | null }) => (r.project ? `${r.project.key}-${r.id.slice(-4).toUpperCase()}` : r.id.slice(-6).toUpperCase());

/**
 * 需求移入 Bug（Figma 51）
 * POST { ids, severity, frontend: "keep" | "none" | <userId>, backend: "keep" | "none" | <userId>, keep: boolean, fallbackProjectId?, dryRun? }
 * frontend / backend 为 "keep" 时沿用需求里的前端 / 后端负责人（默认）
 * 标题、描述（含图片）、项目、产品模块、计划完成（→ 截止日期）带到 Bug；keep=false 时原需求进回收站（30 天内可恢复），
 * keep=true 时保留需求并让 Bug 关联它。处理人不是目标项目成员时留空。
 */

export async function POST(session: SessionUser, body: { ids?: unknown; severity?: string; frontend?: string; backend?: string; keep?: boolean; fallbackProjectId?: string; dryRun?: boolean }) {
  const ids = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String))).slice(0, MAX) : [];
  if (!ids.length) return result({ error: "请先选择需求" }, { status: 400 });
  const severity = (SEVERITY_OPTIONS as readonly string[]).includes(String(body.severity)) ? String(body.severity) : "major";
  const keep = body.keep === true;
  const fallback = body.fallbackProjectId ? String(body.fallbackProjectId) : null;
  if (fallback && !(await prisma.project.findFirst({ where: { id: fallback, status: { notIn: ["archived", "space"] } }, select: { id: true } }))) {
    return result({ error: "选择的项目不存在或已归档" }, { status: 400 });
  }

  // 只处理数据范围内的需求：否则「保留并关联」能把别的项目的需求内容复制到自己的项目里看
  const rows = await prisma.requirement.findMany({
    where: { id: { in: ids }, AND: [requirementWhere(await getAccess(session))] },
    select: {
      id: true,
      title: true,
      summary: true,
      descriptionHtml: true,
      projectId: true,
      productId: true,
      productNodeId: true,
      plannedEndAt: true,
      project: { select: { key: true } },
      assignees: { select: { role: true, userId: true } },
    },
  });
  const perm = new Map<string, boolean>();
  const allowed = async (feature: string, projectId: string | null) => {
    const k = `${feature}:${projectId || ""}`;
    if (!perm.has(k)) perm.set(k, await can(session, feature, projectId || undefined));
    return perm.get(k)!;
  };

  const plan: { r: (typeof rows)[number]; projectId: string }[] = [];
  const skipped: { id: string; code: string; reason: string }[] = [];
  for (const r of rows) {
    const projectId = r.projectId || fallback;
    if (!projectId) {
      skipped.push({ id: r.id, code: code(r), reason: "在公共池里，先选择要放到哪个项目" });
      continue;
    }
    if (!keep && !(await allowed("requirements.edit", r.projectId))) {
      skipped.push({ id: r.id, code: code(r), reason: "没有删除这条需求的权限（可改为「保留并关联」）" });
      continue;
    }
    if (!(await allowed("bugs.edit", projectId))) {
      skipped.push({ id: r.id, code: code(r), reason: "没有在该项目提交 Bug 的权限" });
      continue;
    }
    plan.push({ r, projectId });
  }
  if (body.dryRun) return result({ ok: plan.length, skipped });

  const memberCache = new Map<string, Set<string>>();
  const membersOf = async (projectId: string) => {
    if (!memberCache.has(projectId)) {
      const ms = await prisma.projectMember.findMany({ where: { projectId, user: { isActive: true } }, select: { userId: true } });
      memberCache.set(projectId, new Set(ms.map((m) => m.userId)));
    }
    return memberCache.get(projectId)!;
  };
  const created: { requirementId: string; bugId: string }[] = [];
  const touched = new Set<string>();
  for (const { r, projectId } of plan) {
    // 前端 / 后端负责人：默认沿用需求里的同名槽位；不是 Bug 所在项目成员时留空
    const owner = async (slot: "frontend" | "backend", pick = "keep") => {
      const id = pick === "keep" ? r.assignees.find((a) => a.role === slot)?.userId || null : pick === "none" ? null : pick;
      return id && (await membersOf(projectId)).has(id) ? id : null;
    };
    const frontendId = await owner("frontend", body.frontend);
    const backendId = await owner("backend", body.backend);
    const assigneeId = backendId || frontendId;

    const min = await prisma.bug.aggregate({ where: { projectId, status: "open" }, _min: { boardOrder: true } });
    // 关联需求只能是同项目的需求：公共池需求换了项目时不关联
    const linkReq = keep && r.projectId === projectId;
    const bug = await prisma.bug.create({
      data: {
        title: r.title,
        summary: r.summary,
        descriptionHtml: r.descriptionHtml,
        projectId,
        requirementId: linkReq ? r.id : null,
        productId: r.productId,
        productNodeId: r.productNodeId,
        dueAt: r.plannedEndAt,
        assigneeId,
        frontendId,
        backendId,
        severity,
        status: "open",
        creatorId: session.id,
        boardOrder: (min._min.boardOrder ?? 1) - 1,
      },
    });
    const c = code(r);
    await prisma.activityLog.create({ data: { entityType: "bug", entityId: bug.id, action: "created", actorId: session.id, message: `由需求 ${c} 移入` } });
    await prisma.activityLog.create({
      data: { entityType: "requirement", entityId: r.id, action: linkReq ? "bug_linked" : "updated", actorId: session.id, message: `移入 Bug BUG-${bug.id.slice(-4).toUpperCase()}${keep ? "（保留需求）" : "，需求移到回收站"}` },
    });
    if (!keep) await trash("requirement", r.id, session.id);
    created.push({ requirementId: r.id, bugId: bug.id });
    touched.add(projectId);
  }
  await alignToProjects(Array.from(touched));
  return result({ moved: created.length, created, skipped });
}
