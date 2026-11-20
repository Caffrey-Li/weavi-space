import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeMemberToken } from "@pm-collab/core/api-tokens/admin";

export const dynamic = "force-dynamic";

/** T34：管理员吊销成员令牌（DELETE ?scope=） */
export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await revokeMemberToken(s, new URL(req.url).searchParams.get("scope"), (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
