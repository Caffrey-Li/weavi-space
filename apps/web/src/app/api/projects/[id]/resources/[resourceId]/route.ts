import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

function normalizeUrl(raw: unknown): string | null {
  const url = String(raw || "").trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string; resourceId: string }> }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await can(session, "project.edit", params.id))) {
    return NextResponse.json({ error: "无权限维护项目资料" }, { status: 403 });
  }

  const existing = await prisma.projectResource.findFirst({
    where: { id: params.resourceId, projectId: params.id },
  });
  if (!existing) return NextResponse.json({ error: "资料不存在" }, { status: 404 });

  const body = await req.json();
  const data: { name?: string; url?: string; sortOrder?: number } = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "资料名称必填" }, { status: 400 });
    data.name = name;
  }
  if (body.url !== undefined) {
    const url = normalizeUrl(body.url);
    if (!url) return NextResponse.json({ error: "请填写有效的 http(s) 链接" }, { status: 400 });
    data.url = url;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) return NextResponse.json({ error: "排序无效" }, { status: 400 });
    data.sortOrder = n;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }

  const updated = await prisma.projectResource.update({
    where: { id: params.resourceId },
    data,
  });

  await prisma.activityLog.create({
    data: {
      entityType: "project",
      entityId: params.id,
      action: "resource_updated",
      actorId: session.id,
      fromValue: JSON.stringify({ name: existing.name, url: existing.url, sortOrder: existing.sortOrder }),
      toValue: JSON.stringify(data),
      message: `更新资料：${updated.name}`,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string; resourceId: string }> }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await can(session, "project.edit", params.id))) {
    return NextResponse.json({ error: "无权限维护项目资料" }, { status: 403 });
  }

  const existing = await prisma.projectResource.findFirst({
    where: { id: params.resourceId, projectId: params.id },
  });
  if (!existing) return NextResponse.json({ error: "资料不存在" }, { status: 404 });

  await prisma.projectResource.delete({ where: { id: params.resourceId } });

  await prisma.activityLog.create({
    data: {
      entityType: "project",
      entityId: params.id,
      action: "resource_deleted",
      actorId: session.id,
      fromValue: JSON.stringify({ id: existing.id, name: existing.name, url: existing.url }),
      message: `删除资料：${existing.name}`,
    },
  });

  return NextResponse.json({ ok: true });
}
