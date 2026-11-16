import type { SessionUser } from "../auth";
import { result, conflictResult } from "../requirements/result";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { bugVisible } from "../access";
import { isBugReturn } from "./write";
import { bugStatusLabel } from "../shared/constants";
import { RevisionConflict, STATUS_CONFLICT_MESSAGE } from "../shared/optimistic";
import { onBugStatusChanged } from "../delivery/bug-hook";

export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const status = String(body.status || "");
  const allowed = ["open", "in_progress", "resolved", "closed", "reopened", "cancelled"];
  if (!allowed.includes(status)) return result({ error: "非法状态" }, { status: 400 });
  const existing = await prisma.bug.findFirst({ where: { id: params.id } });
  if (!existing || !(await bugVisible(session, existing.id))) return result({ error: "不存在" }, { status: 404 });
  if (!(await can(session, "bugs.edit", existing.projectId))) {
    return result({ error: "无权限修改 Bug 状态" }, { status: 403 });
  }
  if (existing.status === status) return result({ ok: true });
  const back = isBugReturn(existing.status, status);
  const written = await prisma.bug.updateMany({ where: { id: params.id, status: existing.status }, data: { status, ...(back ? { reopenCount: { increment: 1 } } : {}) } });
  if (written.count === 0) return conflictResult(new RevisionConflict(undefined, STATUS_CONFLICT_MESSAGE));
  const updated = { reopenCount: existing.reopenCount + (back ? 1 : 0) };
  await prisma.activityLog.create({
    data: {
      entityType: "bug",
      entityId: params.id,
      action: "status_changed",
      actorId: session.id,
      fromValue: JSON.stringify({ status: existing.status }),
      toValue: JSON.stringify({ status }),
      message: `${back ? "退回" : "状态"} ${bugStatusLabel(existing.status)} → ${bugStatusLabel(status)}${back ? `（第 ${updated.reopenCount} 次）` : ""}`,
    },
  });
  await onBugStatusChanged(params.id, status);
  return result({ ok: true });
}
