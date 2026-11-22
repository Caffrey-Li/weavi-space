import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateIteration } from "@pm-collab/core/requirements/iterations";

/** 改迭代；{ action: "start" } 开始；{ action: "complete", moveTo? } 完成 */
export async function PATCH(req: Request, props: { params: Promise<{ id: string; iterationId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, iterationId } = await props.params;
  const r = await updateIteration(s, id, iterationId, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
