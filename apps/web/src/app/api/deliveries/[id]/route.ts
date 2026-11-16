import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deliveryAction } from "@pm-collab/core/delivery/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** 需求交付操作：{ action: "cases" | "message" | "suggestion" | "confirm" | "reopen" | "saveCase", ... } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const r = await deliveryAction(s, id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}
