import type { SessionUser } from "../auth";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { listEnterprises } from "./enterprises";
import { GET as listAdmins } from "./admins";

/** Weavi Space 系统后台页面数据；不是系统超管返回 null（页面 notFound） */
export async function loadNovaEnterprisesPage(session: SessionUser | null) {
  if (!session || session.globalRole !== ADMIN_ROLE) return null;
  return { enterprises: await listEnterprises() };
}

export async function loadNovaAdminsPage(session: SessionUser | null) {
  if (!session || session.globalRole !== ADMIN_ROLE) return null;
  const res = await listAdmins(session);
  return res.body as { admins: { id: string; name: string; email: string; isActive: boolean; createdAt: string; self: boolean }[] };
}

/** 演示体验页：演示组织状态、一键体验开关、体验账号、可选岗位（只有系统超管） */
export async function loadNovaDemoPage(session: SessionUser | null) {
  if (!session || session.globalRole !== ADMIN_ROLE) return null;
  const { demoStatus } = await import("../demo/service");
  const { listGuests, oneClickOn } = await import("../demo/guests");
  const { prisma } = await import("@pm-collab/db/prisma");
  const { DEFAULT_POSITIONS } = await import("../shared/roles-shared");
  const [status, oneClick, guests, rows] = await Promise.all([demoStatus(), oneClickOn(), listGuests(session), prisma.position.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, name: true } })]);
  const positions = rows.length ? rows : DEFAULT_POSITIONS.map((p) => ({ key: p.key, name: p.name }));
  return { status, oneClick, guests: "guests" in guests ? guests.guests : [], positions };
}
