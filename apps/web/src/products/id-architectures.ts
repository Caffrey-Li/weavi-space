import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardProductWrite } from "@pm-collab/core/products/guard";
import { readArchForm } from "@pm-collab/core/products/architecture-write";
import * as service from "@pm-collab/core/products/id-architectures";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const denied = await guardProductWrite(session, params.id);
  if (denied) return NextResponse.json(denied.body, denied.init);
  const form = await readArchForm(req);
  const response = await service.POST(session, params, form);
  return NextResponse.json(response.body, response.init);
}
