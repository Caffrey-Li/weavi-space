import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanSchedule, type ScheduleInput } from "@/lib/schedules-shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await prisma.userSchedule.findMany({ where: { userId: session.id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ schedules: rows });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if ((await prisma.userSchedule.count({ where: { userId: session.id } })) >= 20) return NextResponse.json({ error: "每人最多 20 个定时任务" }, { status: 400 });
  try {
    const data = cleanSchedule((await req.json().catch(() => ({}))) as ScheduleInput);
    const row = await prisma.userSchedule.create({ data: { ...(data as { name: string; kind: string; time: string; weekdays: string; channel: string }), userId: session.id } });
    return NextResponse.json({ schedule: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 });
  }
}
