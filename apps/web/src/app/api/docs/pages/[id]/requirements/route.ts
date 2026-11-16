import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createFromDoc, extractCandidates } from "@pm-collab/core/requirements/flow";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 从文档提取需求（T26）：{ action: "extract", credentialId, model } 返回候选；{ action: "create", items } 建需求并关联文档 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "create" ? await createFromDoc(s, id, body) : await extractCandidates(s, id, body);
  return NextResponse.json(r.body, r.init);
}
