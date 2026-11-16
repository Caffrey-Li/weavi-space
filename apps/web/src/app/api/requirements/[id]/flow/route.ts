import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { convertToDoc, requirementFlow, setPrimaryDoc } from "@pm-collab/core/requirements/flow";

export const dynamic = "force-dynamic";

/** 需求进度（T26）：当前阶段、下一步、需求文档 / PRD / 用例入口 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const flow = await requirementFlow(s, (await props.params).id);
  return flow ? NextResponse.json(flow) : NextResponse.json({ error: "需求不存在" }, { status: 404 });
}

/** { action: "convert", projectId? }：转化为需求文档；{ action: "setDoc", pageId | null }：关联 / 更换 / 取消主需求文档 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "convert" ? await convertToDoc(s, id, body) : body.action === "setDoc" ? await setPrimaryDoc(s, id, body) : { body: { error: "未知操作" }, init: { status: 400 } };
  return NextResponse.json(r.body, r.init);
}
