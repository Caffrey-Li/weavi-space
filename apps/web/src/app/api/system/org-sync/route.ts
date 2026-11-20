import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgSyncInfo, runOrgSync } from "@pm-collab/core/orgs/feishu-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** T40 飞书组织同步：GET ?scope= 状态；POST { scope, apply, options } 预览或执行 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await orgSyncInfo(s, new URL(req.url).searchParams.get("scope"));
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await runOrgSync(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
