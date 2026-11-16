import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteLink } from "@pm-collab/core/cloud-docs/service";

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const r = await deleteLink(s, (await props.params).id);
  return NextResponse.json(r.body, r.init);
}
