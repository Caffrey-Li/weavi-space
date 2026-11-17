import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createGuest, deleteGuest, listGuests, updateGuest } from "@pm-collab/core/demo/guests";

export const dynamic = "force-dynamic";

type R = { error: string; status: number } | Record<string, unknown>;
const out = (r: R) => ("error" in r && typeof r.status === "number" ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json(r));

/** 体验账号（系统超管）：GET 列表；POST 新建；PATCH { id, action }；DELETE ?id= */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return out(await listGuests(s));
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return out(await createGuest(s, (await req.json().catch(() => ({}))) as Record<string, unknown>));
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return out(await updateGuest(s, (await req.json().catch(() => ({}))) as Record<string, unknown>));
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return out(await deleteGuest(s, new URL(req.url).searchParams.get("id") || ""));
}
