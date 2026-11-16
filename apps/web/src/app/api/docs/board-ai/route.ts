import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { boardAi } from "@pm-collab/core/docs/board-ai";

export const dynamic = "force-dynamic";

/** 画布「让小围画」：描述 → Mermaid 代码 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "参数错误" }, { status: 400 });
  const r = await boardAi(session, body);
  return NextResponse.json(r.body, r.init);
}
