import type { SessionUser } from "../auth";
import { syncParentOnline } from "./flow";
import { result, conflictResult } from "./result";
import { checkStatusChange } from "../flow/service";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "../permissions";
import { requirementVisible } from "../access";
import { REQ_STATUS, reqStatusLabel } from "../shared/constants";
import { RevisionConflict, STATUS_CONFLICT_MESSAGE } from "../shared/optimistic";

const ALLOWED = REQ_STATUS.map((s) => s.key);


export async function PATCH(session: SessionUser, params: { id: string }, body: Record<string, unknown>) {
  const status = String(body.status || "");
  if (!ALLOWED.includes(status as (typeof ALLOWED)[number])) {
    return result({ error: "非法状态" }, { status: 400 });
  }
  const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
  if (!existing || !(await requirementVisible(session, existing.id))) return result({ error: "不存在" }, { status: 404 });

  if (!(await can(session, "board.move", existing.projectId || undefined))) {
    return result({ error: "无权限修改需求状态" }, { status: 403 });
  }

  if (existing.status === status) return result({ ok: true, requirement: existing });

  // T41 流程：目标状态在本项目停用、或要求评审通过才能离开需求阶段
  const flowError = await checkStatusChange(existing, status);
  if (flowError) return result({ error: flowError, code: "flow_blocked" }, { status: 400 });

  // 进入「已上线」记录实际完成时间；从已上线退回（例如撤销）则清掉，避免完成时间残留
  const wasOnline = existing.status === "online";
  const actualEndAt = status === "online" ? (wasOnline ? existing.actualEndAt : new Date()) : wasOnline ? null : existing.actualEndAt;

  // 比较后写入：读完之后状态被别人改过（比如两人同时拖动）就返回 409，前端回滚并提示刷新。状态不占用 revision（见 prisma.ts）
  const written = await prisma.requirement.updateMany({
    where: { id: params.id, status: existing.status },
    data: {
      status,
      boardOrder: typeof body.boardOrder === "number" ? body.boardOrder : existing.boardOrder,
      actualEndAt,
    },
  });
  if (written.count === 0) return conflictResult(new RevisionConflict(undefined, STATUS_CONFLICT_MESSAGE));
  const updated = await prisma.requirement.findUnique({ where: { id: params.id } });

  await prisma.activityLog.create({
    data: {
      entityType: "requirement",
      entityId: params.id,
      action: "status_changed",
      actorId: session.id,
      fromValue: JSON.stringify({ status: existing.status }),
      toValue: JSON.stringify({ status }),
      message: `状态 ${reqStatusLabel(existing.status)} → ${reqStatusLabel(status)}`,
    },
  });

  if (status === "online" || status === "cancelled") await syncParentOnline(session.id, [params.id]);
  return result({ ok: true, requirement: updated });
}
