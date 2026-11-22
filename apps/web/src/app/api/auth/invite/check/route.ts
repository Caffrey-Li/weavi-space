import { NextResponse } from "next/server";
import { inviteSummary, inviteTokenFrom } from "@pm-collab/core/login/invite-entry";
import { accountLocked, clientIp, hitIp, recordFailure } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * 登录页「邀请登录」识别邀请（公开接口）：POST { invite }，可以是整条链接或 8 位邀请码。不消耗令牌。
 * 防猜邀请码：按 IP 限流；同一 IP 连续输错 5 次锁 15 分钟（邀请码 31^8 ≈ 8500 亿种）。
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const lockKey = `invite-code:${ip}`;
  const wait = hitIp(ip, "invite-check") ?? accountLocked(lockKey, ip);
  if (wait) return NextResponse.json({ error: `尝试太频繁，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const body = (await req.json().catch(() => ({}))) as { invite?: unknown };
  const token = inviteTokenFrom(String(body.invite ?? ""));
  const info = token ? await inviteSummary(token) : null;
  if (!info) {
    recordFailure(lockKey, ip);
    return NextResponse.json({ error: "邀请码无效、已被使用或已过期，请联系发给你的人重新获取" }, { status: 410 });
  }
  return NextResponse.json({ token, info });
}
