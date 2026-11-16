import type { SessionUser } from "../auth";
import { result, conflictResult } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { canSeeProject } from "../access";
import { parseDate } from "../requirement-write";
import { RevisionConflict, baseRevision } from "../shared/optimistic";

export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const existing = await prisma.release.findUnique({ where: { id: params.id }, include: { items: true } });
  // 不在数据范围内按不存在处理，不暴露其他企业 / 不可见项目的发版是否存在
  if (!existing || !(await canSeeProject(session, existing.projectId))) return result({ error: "发版不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", existing.projectId))) {
    return result({ error: "无权限管理发版" }, { status: 403 });
  }
  if (existing.status === "released" || existing.status === "cancelled") {
    return result({ error: "已上线或已取消的版本不能再修改内容" }, { status: 409 });
  }
  const data: Record<string, unknown> = {};
  if ("version" in body) {
    const version = String(body.version || "").trim().replace(/^v/i, "");
    if (!version) return result({ error: "版本号必填" }, { status: 400 });
    if (version !== existing.version) {
      const dup = await prisma.release.findUnique({
        where: { projectId_version: { projectId: existing.projectId, version } },
      });
      if (dup) return result({ error: `该项目已存在版本 v${version}` }, { status: 400 });
      data.version = version;
    }
  }
  if ("title" in body) data.title = body.title ? String(body.title).trim() || null : null;
  if ("description" in body) data.description = body.description ? String(body.description) : null;
  if ("plannedAt" in body) data.plannedAt = parseDate(body.plannedAt);
  if ("reason" in body && existing.kind === "hotfix") {
    const reason = String(body.reason || "").trim();
    if (!reason) return result({ error: "请说明紧急发版的原因" }, { status: 400 });
    data.reason = reason.slice(0, 2000);
  }
  let base: number;
  try {
    base = baseRevision(body, existing.revision);
  } catch (e) {
    if (e instanceof RevisionConflict) return conflictResult(e);
    throw e;
  }
  if (existing.status === "frozen" && Array.isArray(body.requirementIds)) {
    const want = new Set(body.requirementIds.map(String));
    const have = new Set(existing.items.map((i) => i.requirementId));
    const same = want.size === have.size && Array.from(want).every((id) => have.has(id));
    if (!same) return result({ error: "版本已冻结，需先「解除冻结」才能调整关联需求" }, { status: 409 });
  }
  let revision = existing.revision;
  if (Object.keys(data).length || Array.isArray(body.requirementIds) || Array.isArray(body.bugIds)) {
    const written = await prisma.release.updateMany({
      where: { id: existing.id, revision: base },
      data: Object.keys(data).length ? data : { updatedAt: new Date(), revision: { increment: 1 } },
    });
    if (written.count === 0) return conflictResult(new RevisionConflict());
    revision = base + 1;
  }
  let added = 0;
  let removed = 0;
  if (Array.isArray(body.requirementIds)) {
    const ids: string[] = body.requirementIds.map(String);
    const valid = await prisma.requirement.findMany({
      where: { id: { in: ids }, projectId: existing.projectId },
      select: { id: true },
    });
    const keep = new Set(valid.map((v) => v.id));
    const have = new Set(existing.items.map((i) => i.requirementId));
    const toRemove = existing.items.filter((i) => !keep.has(i.requirementId)).map((i) => i.id);
    const toAdd = Array.from(keep).filter((id) => !have.has(id));
    if (toRemove.length) await prisma.releaseRequirement.deleteMany({ where: { id: { in: toRemove } } });
    let order = existing.items.length;
    for (const rid of toAdd) {
      await prisma.releaseRequirement.create({ data: { releaseId: existing.id, requirementId: rid, sortOrder: order++ } });
    }
    added = toAdd.length;
    removed = toRemove.length;
  }
  let bugsAdded = 0;
  let bugsRemoved = 0;
  if (Array.isArray(body.bugIds)) {
    const want = body.bugIds.map(String).slice(0, 200);
    const valid = await prisma.bug.findMany({ where: { id: { in: want }, projectId: existing.projectId }, select: { id: true } });
    const keep = new Set(valid.map((b) => b.id));
    const have = await prisma.releaseBug.findMany({ where: { releaseId: existing.id }, select: { id: true, bugId: true } });
    const haveIds = new Set(have.map((h) => h.bugId));
    const drop = have.filter((h) => !keep.has(h.bugId)).map((h) => h.id);
    const add = Array.from(keep).filter((id) => !haveIds.has(id));
    if (drop.length) await prisma.releaseBug.deleteMany({ where: { id: { in: drop } } });
    for (const bugId of add) await prisma.releaseBug.create({ data: { releaseId: existing.id, bugId } });
    bugsAdded = add.length;
    bugsRemoved = drop.length;
  }
  if (Object.keys(data).length || added || removed || bugsAdded || bugsRemoved) {
    await prisma.activityLog.create({
      data: {
        entityType: "release",
        entityId: existing.id,
        action: "updated",
        actorId: session.id,
        message: `编辑发版${added || removed ? `（关联需求 +${added} / -${removed}）` : ""}${bugsAdded || bugsRemoved ? `（关联 Bug +${bugsAdded} / -${bugsRemoved}）` : ""}`,
      },
    });
  }
  return result({ ok: true, added, removed, bugsAdded, bugsRemoved, revision });
}
