import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** 立即发送一次（不影响按时发送） */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const row = await prisma.userSchedule.findUnique({ where: { id: params.id } });
  if (!row || row.userId !== session.id) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const r = await runSchedule(row.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
