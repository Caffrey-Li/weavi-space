import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bindAccount, bindStatus, sendBindCode } from "@pm-collab/core/login/bind";
import { clientIp, hitIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** 本人绑定邮箱 / 手机号：GET 状态；POST { action: send | bind, channel: email | sms, target, code? } */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await bindStatus(session.id));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.isDemo) return NextResponse.json({ error: "演示账号不能绑定" }, { status: 403 });
  const wait = hitIp(clientIp(req.headers), "bind");
  if (wait) return NextResponse.json({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "send" ? await sendBindCode(session.id, body.channel, body.target) : await bindAccount(session.id, body.channel, body.target, body.code);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
