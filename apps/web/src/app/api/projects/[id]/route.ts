import { NextResponse } from "next/server";
import { alignToProjects } from "@/lib/cascade";
import { prisma } from "@/lib/prisma";
import { dayNoon } from "@pm-collab/core/shared/release-schedule-shared";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canSeeProject } from "@/lib/access";
import { moveProjectEnterprise } from "@/lib/enterprise";

const STATUSES = ["active", "archived", "completed"] as const;

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return dayNoon(String(v));
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project || !(await canSeeProject(session, project.id))) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await can(session, "project.edit", params.id))) {
    return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
  }

  const existing = await prisma.project.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "项目名称必填" }, { status: 400 });
    data.name = name;
  }
  if (body.systemName !== undefined) {
    const systemName = String(body.systemName || "").trim();
    if (!systemName) return NextResponse.json({ error: "系统名称必填" }, { status: 400 });
    data.systemName = systemName;
  }
  if (body.key !== undefined) {
    const key = String(body.key || "").trim().toUpperCase();
    if (!key) return NextResponse.json({ error: "项目标识必填" }, { status: 400 });
    if (key !== existing.key) {
      const clash = await prisma.project.findUnique({ where: { key } });
      if (clash) return NextResponse.json({ error: "项目标识已存在" }, { status: 400 });
    }
    data.key = key;
  }
  if (body.description !== undefined) {
    data.description = body.description ? String(body.description) : null;
  }
  if (body.launchNotes !== undefined) {
    data.launchNotes = body.launchNotes ? String(body.launchNotes) : null;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "非法项目状态" }, { status: 400 });
    }
    data.status = status;
  }
  if (body.plannedEndAt !== undefined) {
    const d = parseDate(body.plannedEndAt);
    if (body.plannedEndAt && d === undefined) {
      return NextResponse.json({ error: "计划完成日期无效" }, { status: 400 });
    }
    data.plannedEndAt = d ?? null;
  }
  if (body.actualEndAt !== undefined) {
    const d = parseDate(body.actualEndAt);
    if (body.actualEndAt && d === undefined) {
      return NextResponse.json({ error: "实际完成日期无效" }, { status: 400 });
    }
    data.actualEndAt = d ?? null;
  }

  if (body.productId !== undefined) {
    const productId = body.productId ? String(body.productId) : null;
    if (productId && productId !== existing.productId && !(await prisma.product.findFirst({ where: { id: productId, status: { not: "archived" } }, select: { id: true } }))) {
      return NextResponse.json({ error: "所选产品不存在或已归档" }, { status: 400 });
    }
    data.productId = productId;
  }
  // 换所属企业：只有系统管理员
  const moving = body.enterpriseId !== undefined && (body.enterpriseId || null) !== existing.enterpriseId;
  const targetEnterprise = moving ? (body.enterpriseId ? String(body.enterpriseId) : null) : existing.enterpriseId;
  if (moving) {
    if (session.globalRole !== "admin") return NextResponse.json({ error: "只有系统管理员可以调整所属企业" }, { status: 403 });
    if (targetEnterprise && (await prisma.organization.findUnique({ where: { id: targetEnterprise }, select: { type: true } }))?.type !== "enterprise") {
      return NextResponse.json({ error: "所选企业不存在" }, { status: 400 });
    }
  }
  // 新选的产品必须和项目在同一企业；换企业时旧产品不在新企业的，在事务里解除
  const nextProductId = "productId" in data ? (data.productId as string | null) : existing.productId;
  if (nextProductId && nextProductId !== existing.productId) {
    const pr = await prisma.product.findUnique({ where: { id: nextProductId }, select: { enterpriseId: true } });
    if (pr?.enterpriseId !== targetEnterprise) return NextResponse.json({ error: "所选产品不属于项目所在企业" }, { status: 400 });
  }

  if (Object.keys(data).length === 0 && !moving) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }

  if (moving) {
    const { detached } = await moveProjectEnterprise(params.id, targetEnterprise, data, nextProductId);
    await prisma.activityLog.create({
      data: { entityType: "project", entityId: params.id, action: "enterprise_moved", actorId: session.id, fromValue: existing.enterpriseId, toValue: targetEnterprise, message: `调整所属企业${detached ? "，所属产品已解除" : ""}` },
    });
    await alignToProjects([params.id]);
    return NextResponse.json({ ok: true, id: params.id, detached });
  }

  const updated = await prisma.project.update({
    where: { id: params.id },
    data,
  });
  // 换了所属产品：需求 / Bug 的产品跟着项目走
  if ("productId" in data && data.productId !== existing.productId) await alignToProjects([params.id]);

  await prisma.activityLog.create({
    data: {
      entityType: "project",
      entityId: params.id,
      action: "updated",
      actorId: session.id,
      fromValue: JSON.stringify({
        name: existing.name,
        systemName: existing.systemName,
        key: existing.key,
        status: existing.status,
        plannedEndAt: existing.plannedEndAt,
        actualEndAt: existing.actualEndAt,
      }),
      toValue: JSON.stringify(data),
      message: "编辑项目信息",
    },
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
