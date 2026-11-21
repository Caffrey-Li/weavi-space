import { NextResponse } from "next/server";
import { inviteSummary, inviteTokenFrom } from "@pm-collab/core/login/invite-entry";
import { clientIp, hitIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** 登录页「邀请登录」识别邀请（公开接口）：POST { invite }，可以是整条链接或邀请码。不消耗令牌 */
export async function POST(req: Request) {
  const wait = hitIp(clientIp(req.headers), "invite-check");
  if (wait) return NextResponse.json({ error: `请求太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const body = (await req.json().catch(() => ({}))) as { invite?: unknown };
  const token = inviteTokenFrom(String(body.invite ?? ""));
  const info = token ? await inviteSummary(token) : null;
  if (!info) return NextResponse.json({ error: "邀请无效、已被使用或已过期，请联系发给你的人重新获取" }, { status: 410 });
  return NextResponse.json({ token, info });
}
