import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deliveryLive } from "@pm-collab/core/delivery/service";

export const dynamic = "force-dynamic";

/** T53 生成中的实时内容：?what=prd | cases | report | chat */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const what = new URL(req.url).searchParams.get("what") || "prd";
  const r = await deliveryLive(s, id, what);
  return NextResponse.json(r.body, r.init);
}
