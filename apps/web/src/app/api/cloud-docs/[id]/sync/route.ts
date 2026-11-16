import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { syncLink } from "@pm-collab/core/cloud-docs/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await syncLink(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
