import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 设置 · 账号：本人修改姓名（账号、岗位、角色由管理员在成员管理里改） */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: "姓名最多 40 个字" }, { status: 400 });
  const updated = await prisma.user.update({ where: { id: session.id }, data: { name } });
  return NextResponse.json({ ok: true, name: updated.name });
}
