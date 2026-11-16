import { NextResponse } from "next/server";
import { needsSetup } from "@pm-collab/core/setup/service";

export const dynamic = "force-dynamic";

/** 公开：系统是否还需要首次安装（登录页据此跳到 /setup） */
export async function GET() {
  return NextResponse.json({ needsSetup: await needsSetup() });
}
