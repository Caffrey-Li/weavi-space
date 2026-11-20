import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteEnterpriseSkill, enterpriseSkillAdmin, saveEnterpriseSkill } from "@pm-collab/core/skills/service";

export const dynamic = "force-dynamic";

/** T35 企业 skill 管理：GET ?scope= 列表；POST 新建 / 修改；DELETE ?scope=&id= 删除 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await enterpriseSkillAdmin(s, new URL(req.url).searchParams.get("scope"));
  return NextResponse.json(r.body, r.init);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await saveEnterpriseSkill(s, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r.body, r.init);
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await deleteEnterpriseSkill(s, sp.get("scope"), sp.get("id") || "");
  return NextResponse.json(r.body, r.init);
}
