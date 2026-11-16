import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { guestLogin } from "@pm-collab/core/login/guest";
import { clientIp } from "@pm-collab/core/shared/rate-limit";

export const dynamic = "force-dynamic";

/** 演示站访客一键体验（GUEST_DEMO=1 才可用）：建只读会话 */
export async function POST() {
  const r = await guestLogin(clientIp(await headers()));
  return NextResponse.json(r.body, r.init);
}
