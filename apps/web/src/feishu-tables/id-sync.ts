import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as service from "@pm-collab/core/feishu-tables/id-sync";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const response = await service.POST(
    session,
    params,
    () => req.json().catch(() => ({})) as Promise<{ direction?: string; apply?: boolean; autoTitle?: boolean }>,
  );
  return NextResponse.json(response.body, response.init);
}
