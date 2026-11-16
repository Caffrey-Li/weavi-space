import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canSeeProject } from "@/lib/access";

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

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project || !(await canSeeProject(session, project.id))) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const resources = await prisma.projectResource.findMany({
    where: { projectId: params.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(resources);
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await can(session, "project.edit", params.id))) {
    return NextResponse.json({ error: "无权限维护项目资料" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const body = await req.json();
  const name = String(body.name || "").trim();
  const url = normalizeUrl(body.url);
  if (!name) return NextResponse.json({ error: "资料名称必填" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "请填写有效的 http(s) 链接" }, { status: 400 });

  const maxOrder = await prisma.projectResource.aggregate({
    where: { projectId: params.id },
    _max: { sortOrder: true },
  });
  const sortOrder =
    body.sortOrder != null && Number.isFinite(Number(body.sortOrder))
      ? Number(body.sortOrder)
      : (maxOrder._max.sortOrder ?? -1) + 1;

  const resource = await prisma.projectResource.create({
    data: {
      projectId: params.id,
      name,
      url,
      sortOrder,
    },
  });

  await prisma.activityLog.create({
    data: {
      entityType: "project",
      entityId: params.id,
      action: "resource_added",
      actorId: session.id,
      toValue: JSON.stringify({ id: resource.id, name, url }),
      message: `添加资料：${name}`,
    },
  });

  return NextResponse.json(resource);
}
