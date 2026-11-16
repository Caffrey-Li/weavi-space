import { NextResponse } from "next/server";
import { loginOptions } from "@pm-collab/core/login/service";

export const dynamic = "force-dynamic";

/** 登录页可用的登录方式（公开）：?org=<企业编码> */
export async function GET(req: Request) {
  const org = new URL(req.url).searchParams.get("org");
  return NextResponse.json(await loginOptions(org ? org.slice(0, 40) : null));
}
