import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getAccess, productWhere, projectWhere, userWhere } from "@/lib/access";
import { listPositions } from "@/lib/roles";
import { listOrgs } from "@/lib/org";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const access = await getAccess(session);
  const [projects, users, releases, positions, products] = await Promise.all([
    prisma.project.findMany({ where: { status: "active", ...projectWhere(access) }, select: { id: true, name: true, key: true, iconUrl: true, productId: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { isActive: true, ...userWhere(access) }, select: { id: true, name: true, email: true, globalRole: true, position: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    // 新建需求时可直接放进「规划中」的版本
    prisma.release.findMany({ where: { status: "planning", ...(access.projectIds ? { projectId: { in: access.projectIds } } : {}) }, select: { id: true, version: true, title: true, projectId: true }, orderBy: [{ plannedAt: "asc" }] }),
    listPositions(),
    // 新建 / 编辑项目时选「所属产品」：未归档的产品
    prisma.product.findMany({ where: { status: { not: "archived" }, archivedAt: null, AND: [productWhere(access)] }, select: { id: true, name: true, code: true, enterpriseId: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  // 企业列表只给系统管理员：选所属企业的入口只对它开放
  const enterprises = session.globalRole === "admin" ? (await listOrgs()).filter((o) => o.type === "enterprise").map((o) => ({ id: o.id, name: o.name })) : [];
  return NextResponse.json({ enterprises, projects, users, releases, positions: positions.map((p) => ({ key: p.key, name: p.name })), products });
}
