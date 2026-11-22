import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assignIteration, createIteration, projectIterations } from "@pm-collab/core/requirements/iterations";

export const dynamic = "force-dynamic";

/** 项目迭代（T43，Scrum 模式） */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const data = await projectIterations(s, (await props.params).id);
  return data ? NextResponse.json(data) : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}

/** { action: "assign", iterationId | null, requirementIds } 规划；否则新建 { name?, goal?, startAt, endAt, capacity? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "assign" ? await assignIteration(s, id, body) : await createIteration(s, id, body);
  return NextResponse.json(r.body, r.init);
}
