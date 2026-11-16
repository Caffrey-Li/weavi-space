import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@pm-collab/core/requirement-write";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { applyPatternArt } from "@/lib/project-art";
import { EnterpriseError, enterpriseForNew } from "@/lib/enterprise";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 创建项目：无 projectId，按全局角色校验同一 feature key「编辑项目信息」
  if (!(await can(session, "project.edit"))) {
    return NextResponse.json({ error: "无权限创建项目" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const systemName = String(body.systemName || "").trim();
  const key = String(body.key || "").trim().toUpperCase();
  if (!name) return NextResponse.json({ error: "项目名称必填" }, { status: 400 });
  if (!systemName) return NextResponse.json({ error: "系统名称必填" }, { status: 400 });
  if (!key) return NextResponse.json({ error: "项目标识必填" }, { status: 400 });

  // 所属产品：选填
  const productId = body.productId ? String(body.productId) : null;
  if (productId && !(await prisma.product.findFirst({ where: { id: productId, status: { not: "archived" } }, select: { id: true } }))) {
    return NextResponse.json({ error: "所选产品不存在或已归档" }, { status: 400 });
  }

  let enterpriseId: string | null;
  try {
    enterpriseId = await enterpriseForNew(session, { requested: body.enterpriseId, productId });
  } catch (e) {
    if (e instanceof EnterpriseError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  try {
    const project = await prisma.project.create({
      data: {
        enterpriseId,
        name,
        systemName,
        key,
        description: body.description ? String(body.description) : null,
        launchNotes: body.launchNotes ? String(body.launchNotes) : null,
        status: ["active", "completed", "archived"].includes(body.status) ? body.status : "active",
        plannedEndAt: parseDate(body.plannedEndAt),
        actualEndAt: parseDate(body.actualEndAt),
        productId,
        createdById: session.id,
        members: {
          // 创建人以默认岗位加入（没有默认岗位时记为项目经理）
          create: { userId: session.id, role: (await prisma.user.findUnique({ where: { id: session.id }, select: { position: true } }))?.position || "pm" },
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        entityType: "project",
        entityId: project.id,
        action: "created",
        actorId: session.id,
        message: "创建项目",
      },
    });

    // 新建项目自动配好背景图和图标（内置生成，失败不影响创建）
    await applyPatternArt(project.id, { cover: true, icon: true }).catch((e) => console.error("[配图] 新建项目配图失败", e));
    return NextResponse.json({ id: project.id });
  } catch {
    return NextResponse.json({ error: "创建失败（标识可能重复）" }, { status: 400 });
  }
}
