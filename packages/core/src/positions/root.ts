import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { listPositions } from "../shared/roles";
import { NO_POSITION } from "../shared/roles-shared";
import { randomKey } from "../shared/admin-gate";

/** 岗位列表 + 默认岗位人数 + 项目内任职人数 */
export async function GET(_session: SessionUser) {
  void _session;
  const [positions, users, members] = await Promise.all([
    listPositions(),
    prisma.user.groupBy({ by: ["position"], _count: { _all: true } }),
    prisma.projectMember.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);
  return result({
    positions: positions.map((p) => ({
      ...p,
      userCount: users.find((u) => u.position === p.key)?._count._all || 0,
      memberCount: members.find((m) => m.role === p.key)?._count._all || 0,
    })),
  });
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function POST(session: SessionUser, body: Record<string, unknown>) {
  const name = clean(body.name, 30);
  if (!name) return result({ error: "请填写岗位名称" }, { status: 400 });
  const all = await listPositions();
  if (all.some((p) => p.name === name)) return result({ error: "已有同名岗位" }, { status: 400 });
  let key = randomKey("pos");
  while (all.some((p) => p.key === key) || key === NO_POSITION) key = randomKey("pos");
  const position = await prisma.position.create({
    data: { key, name, description: clean(body.description, 100) || null, isSystem: false, sortOrder: all.length },
  });
  await prisma.activityLog.create({ data: { entityType: "position", entityId: position.id, action: "created", actorId: session.id, toValue: name } });
  return result({ position });
}

/** 改名 / 改说明 / 调整顺序（order: 全部岗位 id 的新顺序） */
export async function PATCH(session: SessionUser, body: Record<string, unknown>) {
  void session;
  if (Array.isArray(body.order)) {
    const ids = body.order.map(String);
    await prisma.$transaction(ids.map((id: string, i: number) => prisma.position.updateMany({ where: { id }, data: { sortOrder: i } })));
    return result({ ok: true });
  }
  const pos = await prisma.position.findUnique({ where: { id: String(body.id || "") } });
  if (!pos) return result({ error: "岗位不存在" }, { status: 404 });
  const data: { name?: string; description?: string | null } = {};
  if (body.name !== undefined) {
    const name = clean(body.name, 30);
    if (!name) return result({ error: "岗位名称不能为空" }, { status: 400 });
    if (name !== pos.name && (await prisma.position.findFirst({ where: { name, NOT: { id: pos.id } } }))) {
      return result({ error: "已有同名岗位" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.description !== undefined) data.description = clean(body.description, 100) || null;
  const position = await prisma.position.update({ where: { id: pos.id }, data });
  return result({ position });
}

/** 删除岗位：内置岗位不能删；仍有人以它为默认岗位或在项目中任职时不能删 */
export async function DELETE(session: SessionUser, requestUrl: string) {
  const id = new URL(requestUrl).searchParams.get("id") || "";
  const pos = await prisma.position.findUnique({ where: { id } });
  if (!pos) return result({ error: "岗位不存在" }, { status: 404 });
  if (pos.isSystem) return result({ error: "内置岗位不能删除" }, { status: 400 });
  const [u, m] = await Promise.all([prisma.user.count({ where: { position: pos.key } }), prisma.projectMember.count({ where: { role: pos.key } })]);
  if (u || m) {
    const parts = [u ? `${u} 人的默认岗位` : "", m ? `${m} 个项目成员` : ""].filter(Boolean).join("、");
    return result({ error: `「${pos.name}」还被 ${parts} 使用，先调整后再删除` }, { status: 400 });
  }
  await prisma.position.delete({ where: { id } });
  await prisma.activityLog.create({ data: { entityType: "position", entityId: id, action: "deleted", actorId: session.id, fromValue: pos.name } });
  return result({ ok: true });
}
