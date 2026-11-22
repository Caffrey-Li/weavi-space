import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createTask, generateTasks, listTasks, moveToRelease, requirementPlan, unshiftTasks } from "@pm-collab/core/requirements/tasks";

export const dynamic = "force-dynamic";

/** 需求任务与计划（T43） */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const [list, plan] = await Promise.all([listTasks(s, id), requirementPlan(s, id)]);
  return list && plan ? NextResponse.json({ ...list, plan }) : NextResponse.json({ error: "需求不存在" }, { status: 404 });
}

/** { action: "create", ...任务 } | { action: "generate", kinds } | { action: "unshift", days } | { action: "moveRelease", releaseId } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r =
    body.action === "generate"
      ? await generateTasks(s, id, body)
      : body.action === "unshift"
        ? await unshiftTasks(s, id, Number(body.days))
        : body.action === "moveRelease"
          ? await moveToRelease(s, id, body)
          : await createTask(s, id, body);
  return NextResponse.json(r.body, r.init);
}
