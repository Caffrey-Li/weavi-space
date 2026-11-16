import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDelivery, startPrd } from "@pm-collab/core/delivery/service";

export const dynamic = "force-dynamic";

/** 需求交付面板数据：?pageId=原始文档 / PRD / 用例页 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const pageId = new URL(req.url).searchParams.get("pageId") || "";
  if (!pageId) return NextResponse.json({ error: "缺少 pageId" }, { status: 400 });
  const r = await getDelivery(s, pageId);
  return NextResponse.json(r.body, r.init);
}

/** 开始（或重新）生成 PRD：{ pageId, skillId, credentialId, model, note? } */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await startPrd(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
