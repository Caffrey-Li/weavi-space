import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 健康检查（Docker / 负载均衡用）：不需要登录，只回答「服务和数据库是否可用」，不返回任何细节。
 * 数据库连不上或还没执行迁移时返回 503。
 */
export async function GET() {
  try {
    await prisma.workspace.count();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
