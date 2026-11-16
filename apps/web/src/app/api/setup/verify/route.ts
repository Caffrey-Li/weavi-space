import { NextResponse } from "next/server";
import { checkSetupCode, needsSetup } from "@pm-collab/core/setup/service";
import { clientIp, hitIp } from "@pm-collab/core/shared/rate-limit";

export const dynamic = "force-dynamic";

/** 首次安装第 1 步：核对安装码（同一 IP 有次数限制） */
export async function POST(req: Request) {
  const wait = hitIp(clientIp(req.headers), "setup");
  if (wait) return NextResponse.json({ error: `尝试次数太多，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  if (!(await needsSetup())) return NextResponse.json({ error: "系统已经有管理员，安装向导已关闭" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  if (!(await checkSetupCode(body.code))) return NextResponse.json({ error: "安装码不对或已过期。到服务器日志里找最新的安装码，过期了重启服务会生成新的" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
