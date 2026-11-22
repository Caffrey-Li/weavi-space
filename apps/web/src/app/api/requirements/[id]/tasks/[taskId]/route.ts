import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteTask, updateTask } from "@pm-collab/core/requirements/tasks";

export async function PATCH(req: Request, props: { params: Promise<{ id: string; taskId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, taskId } = await props.params;
  const r = await updateTask(s, id, taskId, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; taskId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, taskId } = await props.params;
  const r = await deleteTask(s, id, taskId);
  return NextResponse.json(r.body, r.init);
}
