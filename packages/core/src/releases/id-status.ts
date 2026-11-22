import type { SessionUser } from "../auth";
import { syncParentOnline } from "../requirements/flow";
import { result, conflictResult } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { RELEASE_STATUS, reqStatusLabel } from "../shared/constants";
import { RevisionConflict } from "../shared/optimistic";


/** 允许的流转：规划中 → 冻结/发布中/已上线/取消；冻结 → 规划中/发布中/已上线/取消；发布中 → 已上线/取消 */
const TRANSITIONS: Record<string, string[]> = {
  planning: ["frozen", "releasing", "released", "cancelled"],
  frozen: ["planning", "releasing", "released", "cancelled"],
  releasing: ["released", "cancelled"],
  released: [],
  cancelled: ["planning"],
};
export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const status = String(body.status || "");
  if (!RELEASE_STATUS[status]) return result({ error: "非法状态" }, { status: 400 });
  const existing = await prisma.release.findUnique({ where: { id: params.id }, include: { items: true } });
  if (!existing || !(await canSeeProject(session, existing.projectId))) return result({ error: "不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", existing.projectId))) {
    return result({ error: "无权限管理发版" }, { status: 403 });
  }
  if (existing.status === status) return result({ ok: true, synced: 0 });
  if (!(TRANSITIONS[existing.status] || []).includes(status)) {
    return result(
      { error: `当前为「${RELEASE_STATUS[existing.status]?.label || existing.status}」，不能直接改为「${RELEASE_STATUS[status].label}」` },
      { status: 409 },
    );
  }
  // T43 关卡：上线时一起把需求标为已上线的，先按各需求的流程检查「上线」关卡
  if (status === "released" && body.syncRequirements && existing.items.length) {
    const { flowForRequirement } = await import("../flow/service");
    const { missingGates } = await import("../flow/gates");
    const reqs = await prisma.requirement.findMany({ where: { id: { in: existing.items.map((i) => i.requirementId) }, status: { notIn: ["online", "cancelled"] } }, select: { id: true, number: true, projectId: true, creatorId: true, docPageId: true } });
    const blocked: string[] = [];
    for (const r of reqs) {
      const f = await flowForRequirement(r);
      if (!f.gates.some((g) => g.startsWith("online:"))) continue;
      const miss = await missingGates(r, "online", f.gates);
      if (miss.length) blocked.push(`R${r.number} 缺${miss.join("、")}`);
    }
    if (blocked.length) return result({ error: `上线关卡没过：${blocked.slice(0, 5).join("；")}${blocked.length > 5 ? ` 等 ${blocked.length} 条` : ""}`, code: "flow_blocked" }, { status: 400 });
  }
  const now = new Date();
  const written = await prisma.release.updateMany({
    where: { id: params.id, revision: existing.revision },
    data: { status, releasedAt: status === "released" ? now : existing.releasedAt },
  });
  if (written.count === 0) return conflictResult(new RevisionConflict());
  let synced = 0;
  if (status === "released" && body.syncRequirements && existing.items.length) {
    const targets = await prisma.requirement.findMany({
      where: { id: { in: existing.items.map((i) => i.requirementId) }, status: { notIn: ["online", "cancelled"] } },
      select: { id: true, status: true },
    });
    for (const r of targets) {
      await prisma.requirement.update({ where: { id: r.id }, data: { status: "online", actualEndAt: now } });
      await prisma.activityLog.create({
        data: {
          entityType: "requirement",
          entityId: r.id,
          action: "status_changed",
          actorId: session.id,
          fromValue: JSON.stringify({ status: r.status }),
          toValue: JSON.stringify({ status: "online" }),
          message: `随发版 v${existing.version} 上线：${reqStatusLabel(r.status)} → 已上线`,
        },
      });
    }
    synced = targets.length;
  }
  let resolved = 0;
  if (status === "released" && body.resolveBugs) {
    const links = await prisma.releaseBug.findMany({ where: { releaseId: existing.id }, select: { bugId: true } });
    const bugs = links.length
      ? await prisma.bug.findMany({
          where: { id: { in: links.map((l) => l.bugId) }, status: { in: ["open", "in_progress", "reopened"] } },
          select: { id: true, status: true },
        })
      : [];
    for (const b of bugs) {
      const ok = await prisma.bug.updateMany({ where: { id: b.id, status: b.status }, data: { status: "resolved" } });
      if (!ok.count) continue;
      resolved++;
      await prisma.activityLog.create({
        data: {
          entityType: "bug",
          entityId: b.id,
          action: "status_changed",
          actorId: session.id,
          fromValue: JSON.stringify({ status: b.status }),
          toValue: JSON.stringify({ status: "resolved" }),
          message: `随发版 v${existing.version} 上线标记为已解决`,
        },
      });
    }
  }
  await prisma.activityLog.create({
    data: {
      entityType: "release",
      entityId: params.id,
      action: "status_changed",
      actorId: session.id,
      fromValue: JSON.stringify({ status: existing.status }),
      toValue: JSON.stringify({ status }),
      message: `发版状态 ${RELEASE_STATUS[existing.status]?.label || existing.status} → ${RELEASE_STATUS[status].label}${synced ? `，同步上线 ${synced} 条需求` : ""}${resolved ? `，${resolved} 个 Bug 标记为已解决` : ""}`,
    },
  });
  if (status === "released") await syncParentOnline(session.id, existing.items.map((i) => i.requirementId));
  return result({ ok: true, synced, resolved });
}
