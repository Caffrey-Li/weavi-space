import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { testConnection } from "@pm-collab/core/git/service";

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await testConnection(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
