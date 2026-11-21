import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { REQ_STATUS, reqStatusLabel } from "../shared/constants";
import { getHiddenStatuses, saveHiddenStatuses } from "../shared/req-stages";
import { LOCKED_REQ_STATUSES, parseHiddenStatuses } from "../shared/req-stages-shared";

function canEdit(session: SessionUser) {
  return session.globalRole === "admin";
}

/** 各阶段的需求数（含归档，不含回收站），用于停用前提示迁移 */
async function counts() {
  const rows = await prisma.requirement.groupBy({ by: ["status"], _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
}

export async function GET(session: SessionUser) {
  return result({ hidden: await getHiddenStatuses(), counts: canEdit(session) ? await counts() : {}, locked: LOCKED_REQ_STATUSES, canEdit: canEdit(session) });
}

/**
 * POST { hidden: string[], migrate: { [停用阶段]: 目标阶段 } }
 * 新停用的阶段里还有需求时必须给出迁移目标（只能是启用中的阶段），迁移写动态。
 */
export async function POST(session: SessionUser, body: { hidden?: unknown; migrate?: Record<string, string> }) {
  if (!canEdit(session)) return result({ error: "只有管理员可以配置需求阶段" }, { status: 403 });
  const hidden = parseHiddenStatuses(body.hidden);
  const all = REQ_STATUS.map((s) => s.key as string);
  const enabled = all.filter((s) => !hidden.includes(s));
  const before = await getHiddenStatuses();
  const n = await counts();
  const moves: [string, string, number][] = [];
  for (const s of hidden) {
    if (!n[s]) continue;
    const to = body.migrate?.[s];
    if (!to || !enabled.includes(to)) {
      if (before.includes(s)) continue; // 之前就停用了：不强制（可能是外部同步写进来的旧数据）
      return result({ error: `「${s}」还有 ${n[s]} 条需求，请选择迁移到哪个阶段` }, { status: 400 });
    }
    moves.push([s, to, n[s]]);
  }
  for (const [from, to] of moves) {
    const ids = (await prisma.requirement.findMany({ where: { status: from }, select: { id: true } })).map((r) => r.id);
    const now = new Date();
    await prisma.requirement.updateMany({
      where: { id: { in: ids } },
      data: { status: to, ...(to === "online" ? { actualEndAt: now } : {}) },
    });
    await prisma.activityLog.createMany({
      data: ids.map((id) => ({
        entityType: "requirement",
        entityId: id,
        action: "status_changed",
        actorId: session.id,
        fromValue: JSON.stringify({ status: from }),
        toValue: JSON.stringify({ status: to }),
        message: `阶段「${reqStatusLabel(from)}」停用，迁移到「${reqStatusLabel(to)}」`,
      })),
    });
  }
  await saveHiddenStatuses(hidden);
  return result({ ok: true, hidden, migrated: moves.map(([from, to, count]) => ({ from, to, count })) });
}
