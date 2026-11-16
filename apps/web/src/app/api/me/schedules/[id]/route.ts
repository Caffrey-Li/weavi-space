import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanSchedule, type ScheduleInput } from "@/lib/schedules-shared";

export const dynamic = "force-dynamic";

async function own(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const row = await prisma.userSchedule.findUnique({ where: { id } });
  if (!row || row.userId !== session.id) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  return { row };
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const o = await own(params.id);
  if (o.error) return o.error;
  try {
    const body = (await req.json().catch(() => ({}))) as ScheduleInput;
    const data = cleanSchedule({ ...body, kind: body.kind ?? undefined }, true);
    const row = await prisma.userSchedule.update({ where: { id: params.id }, data });
    return NextResponse.json({ schedule: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const o = await own(params.id);
  if (o.error) return o.error;
  await prisma.userSchedule.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
