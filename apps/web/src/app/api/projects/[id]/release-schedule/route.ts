import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canSeeProject } from "@/lib/access";
import {
  describeReleaseSchedule,
  disableReleaseSchedule,
  getReleaseSchedule,
  normalizeSchedule,
  saveReleaseSchedule,
  toConfig,
} from "@/lib/release-schedule";

/** 项目的固定发版节奏：GET 读取、PUT 保存（并按新节奏重新生成未来计划）、DELETE 停用 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canSeeProject(session, id))) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const s = await getReleaseSchedule(id);
  return NextResponse.json({ schedule: s ? { ...toConfig(s), summary: describeReleaseSchedule(toConfig(s)) } : null });
}

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cfg = normalizeSchedule({ ...body, enabled: true });
  if (typeof cfg === "string") return NextResponse.json({ error: cfg }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!project || project.status === "space" || !(await canSeeProject(session, id))) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!(await can(session, "releases.manage", id))) return NextResponse.json({ error: "无权限管理该项目发版" }, { status: 403 });
  const { schedule, removed, created } = await saveReleaseSchedule(id, cfg, session.id);
  await prisma.activityLog.create({
    data: {
      entityType: "project",
      entityId: id,
      action: "release_schedule_saved",
      actorId: session.id,
      toValue: JSON.stringify(cfg),
      message: `设置固定发版节奏：${describeReleaseSchedule(cfg)}${created ? `，生成 ${created} 个发版计划` : ""}${removed ? `，替换 ${removed} 个未使用的旧计划` : ""}`,
    },
  });
  return NextResponse.json({ ok: true, created, removed, schedule: toConfig(schedule) });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canSeeProject(session, id))) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", id))) return NextResponse.json({ error: "无权限管理该项目发版" }, { status: 403 });
  const { removed } = await disableReleaseSchedule(id, session.id);
  await prisma.activityLog.create({
    data: { entityType: "project", entityId: id, action: "release_schedule_disabled", actorId: session.id, message: `停用固定发版节奏${removed ? `，移除 ${removed} 个未使用的计划` : ""}` },
  });
  return NextResponse.json({ ok: true, removed });
}
