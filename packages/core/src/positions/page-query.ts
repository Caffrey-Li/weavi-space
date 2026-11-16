import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { listPositions } from "../shared/roles";

/** 岗位管理页 */
export async function loadPositionsPage(session: SessionUser | null) {
  const canEdit = session?.globalRole === "admin";
  const [positions, users, members] = await Promise.all([
    listPositions(),
    prisma.user.groupBy({ by: ["position"], _count: { _all: true } }),
    prisma.projectMember.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);
  return {
    canEdit,
    positions: positions.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      isSystem: p.isSystem,
      userCount: users.find((u) => u.position === p.key)?._count._all || 0,
      memberCount: members.find((m) => m.role === p.key)?._count._all || 0,
    })),
  };
}
